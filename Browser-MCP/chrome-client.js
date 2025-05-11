import WebSocket from "ws"
import { WebSocketServer } from "ws"
import fs from "fs-extra"
import * as path from "path"
import * as os from "os"
import { WEBSOCKET_PORT, DEFAULT_VIEWPORT, tempHtmlPath, screenshotSaveDir } from "./config.js"
import { exec } from "child_process"

// 添加检测和释放端口的辅助方法
async function checkAndReleasePort(port) {
	console.error(`正在检查端口 ${port} 是否被占用...`)

	// 根据操作系统选择命令
	let command = ""
	if (process.platform === "win32") {
		// Windows
		command = `netstat -ano | findstr :${port}`
	} else {
		// macOS, Linux
		command = `lsof -i:${port} | grep LISTEN`
	}

	try {
		return new Promise((resolve) => {
			exec(command, async (error, stdout, stderr) => {
				if (stdout) {
					console.error(`端口 ${port} 被占用，尝试清理...`)

					if (process.platform === "win32") {
						// 在Windows上，netstat输出包含PID，我们需要解析它
						const lines = stdout.split("\n").filter(Boolean)
						const pids = new Set()

						for (const line of lines) {
							const parts = line.trim().split(/\s+/)
							if (parts.length >= 5) {
								const pid = parts[4]
								if (pid && !isNaN(parseInt(pid))) {
									pids.add(pid)
								}
							}
						}

						// 对每个PID尝试结束进程
						for (const pid of pids) {
							console.error(`尝试结束进程 PID: ${pid}...`)
							try {
								exec(`taskkill /F /PID ${pid}`, (err) => {
									if (err) {
										console.error(`结束进程 ${pid} 失败: ${err.message}`)
									} else {
										console.error(`成功结束进程 ${pid}`)
									}
								})
							} catch (e) {
								console.error(`结束进程出错: ${e.message}`)
							}
						}
					} else {
						// macOS或Linux
						const lines = stdout.split("\n").filter(Boolean)
						const pids = new Set()

						for (const line of lines) {
							const parts = line.trim().split(/\s+/)
							if (parts.length >= 2) {
								const pid = parts[1]
								if (pid && !isNaN(parseInt(pid))) {
									pids.add(pid)
								}
							}
						}

						// 对每个PID尝试结束进程
						for (const pid of pids) {
							console.error(`尝试结束进程 PID: ${pid}...`)
							try {
								exec(`kill -9 ${pid}`, (err) => {
									if (err) {
										console.error(`结束进程 ${pid} 失败: ${err.message}`)
									} else {
										console.error(`成功结束进程 ${pid}`)
									}
								})
							} catch (e) {
								console.error(`结束进程出错: ${e.message}`)
							}
						}
					}

					// 等待进程结束释放端口
					console.error(`等待端口 ${port} 释放...`)
					await new Promise((resolve) => setTimeout(resolve, 2000))
					resolve(true)
				} else {
					console.error(`端口 ${port} 未被占用，可以使用`)
					resolve(false)
				}
			})
		})
	} catch (e) {
		console.error(`检查端口使用时出错: ${e.message}`)
		return false
	}
}

// WebSocket客户端管理
export class ChromeExtensionClient {
	constructor() {
		this.wss = null
		this.clientSocket = null
		this.isReady = false
		this.pendingRequests = new Map()
		this.requestIdCounter = 0
		this.currentUrl = undefined
		this.viewport = { ...DEFAULT_VIEWPORT } // 添加viewport配置
	}

	async initialize() {
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
			return
		}

		// 如果服务器实例存在但可能已关闭或处于错误状态，先关闭它
		if (this.wss) {
			await new Promise((resolve) => {
				// 先关闭客户端连接
				if (this.clientSocket && this.clientSocket.readyState !== WebSocket.CLOSED) {
					try {
						this.clientSocket.terminate ? this.clientSocket.terminate() : this.clientSocket.close()
					} catch (e) {
						// 忽略关闭错误
					}
					this.clientSocket = null
				}
				this.wss?.close((err) => {
					if (err) {
						console.error("关闭现有服务器时出错:", err)
					}
					this.wss = null
					this.isReady = false
					resolve()
				})
			})
			// 添加小延迟确保端口释放
			await new Promise((resolve) => setTimeout(resolve, 500))
		}

		// 重置状态
		this.isReady = false
		this.clientSocket = null
		this.pendingRequests.clear()

		// 尝试最多3次启动WebSocket服务器
		let attempts = 0
		const maxAttempts = 3

		// 先检查端口是否被占用，如果被占用则尝试释放
		await checkAndReleasePort(WEBSOCKET_PORT)

		while (attempts < maxAttempts) {
			attempts++

			try {
				return await new Promise((resolve, reject) => {
					try {
						console.error(`尝试启动WebSocket服务器 (端口:${WEBSOCKET_PORT})，第${attempts}次...`)
						this.wss = new WebSocketServer({ port: WEBSOCKET_PORT })

						this.wss.on("connection", (ws) => {
							if (this.clientSocket && this.clientSocket.readyState === WebSocket.OPEN) {
								this.clientSocket.close()
							}
							this.clientSocket = ws
							this.isReady = true
							console.error("WebSocket客户端已连接")

							// 连接建立后立即调用onConnected
							this.onConnected()

							ws.on("message", (message) => {
								try {
									const parsedMessage = JSON.parse(message.toString())
									this.handleMessageFromClient(parsedMessage)
								} catch (e) {
									console.error("解析客户端消息时出错:", e.message)
								}
							})

							ws.on("close", () => {
								if (this.clientSocket === ws) {
									this.clientSocket = null
									this.isReady = false
									console.error("WebSocket客户端已断开连接")
									const disconnectError = new Error("Chrome extension client disconnected.")
									this.pendingRequests.forEach((req) => req.reject(disconnectError))
									this.pendingRequests.clear()
								}
							})

							ws.on("error", (error) => {
								console.error("WebSocket客户端错误:", error.message)
								if (this.clientSocket === ws) {
									this.clientSocket = null
									this.isReady = false
									const connectError = new Error(`Client WebSocket error: ${error.message}`)
									this.pendingRequests.forEach((req) => req.reject(connectError))
									this.pendingRequests.clear()
								}
							})

							resolve()
						})

						this.wss.on("error", (error) => {
							// 端口冲突错误特殊处理
							if (error.code === "EADDRINUSE") {
								console.error(`端口 ${WEBSOCKET_PORT} 已被占用，尝试强制关闭...`)
								this.isReady = false
								this.wss = null
								reject(new Error(`端口 ${WEBSOCKET_PORT} 已被占用`))
							} else {
								console.error("WebSocket服务器错误:", error.message)
								this.isReady = false
								this.wss = null
								this.clientSocket = null
								const serverError = new Error(`WebSocket server error: ${error.message}`)
								this.pendingRequests.forEach((req) => req.reject(serverError))
								this.pendingRequests.clear()
								reject(error)
							}
						})

						this.wss.on("close", () => {
							console.error("WebSocket服务器已关闭")
							this.wss = null
							this.clientSocket = null
							this.isReady = false
						})
					} catch (error) {
						console.error("创建WebSocket服务器失败:", error.message)
						reject(error)
					}
				})
			} catch (error) {
				console.error(`启动WebSocket服务器失败 (第${attempts}次尝试): ${error.message}`)

				// 如果是端口被占用的错误，尝试强制释放
				if (error.message.includes("端口") && error.message.includes("已被占用")) {
					console.error("正在尝试强制释放端口，等待更长时间...")
					// 尝试强制释放端口，给足够时间让操作系统释放资源
					await new Promise((resolve) => setTimeout(resolve, 2000))
				}

				// 如果这是最后一次尝试，则抛出错误
				if (attempts >= maxAttempts) {
					throw new Error(`启动WebSocket服务器失败，已重试${maxAttempts}次: ${error.message}`)
				}
			}
		}
	}

	handleMessageFromClient(message) {
		const { requestId, status, command } = message

		// 处理从扩展接收的viewport同步消息
		if (command === "viewportSync" && message.viewport) {
			//console.error("[ChromeExtensionClient] 收到扩展viewport同步:", message.viewport)

			// 更新客户端viewport
			this.viewport = { ...message.viewport }
			console.error("[ChromeExtensionClient] 已更新viewport配置:", this.viewport)

			// 不需要响应，这是扩展主动发送的同步消息
			return
		}

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
			console.error(`[DEBUG] Error response for command ${pendingRequest.command}: ${message.message}`)
			pendingRequest.reject(new Error(message.message || `Command '${pendingRequest.command}' failed.`))
		} else if (status === "ack" || status === "success") {
			//console.error(
			//	`[DEBUG] Success/ack response for command ${pendingRequest.command}, has tabId: ${!!message.tabId}, current targetTabId: ${this.targetTabId}`,
			//)

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
				tabs: message.tabs,
				tabId: message.tabId,
				htmlContent: message.htmlContent,
				// 保留新标签页信息传递
				...(message.newTabOpened && { newTabOpened: message.newTabOpened }),
				...(message.newTabId && { newTabId: message.newTabId }),
				...(message.newTabUrl && { newTabUrl: message.newTabUrl }),
			})
		} else {
			pendingRequest.reject(new Error(`Received unhandled status '${status}' for command '${pendingRequest.command}'.`))
		}
	}

	sendMessageToClient(message, command) {
		const requestId = `req-${this.requestIdCounter++}`
		// 不再包含targetTabId
		const messageToSend = {
			...message,
			requestId,
			command,
			source: "mcpServer",
		}

		//console.error(`[DEBUG] Sending ${command} command with targetTabId=${includeTargetTab ? this.targetTabId : "none"}`)

		if (!this.clientSocket || this.clientSocket.readyState !== WebSocket.OPEN) {
			// console.error("ChromeExtensionClient: Cannot send message, client not connected or ready.")
			throw new Error("Chrome extension client is not connected.")
		}

		try {
			const messageString = JSON.stringify(messageToSend)
			this.clientSocket.send(messageString)
			return requestId
		} catch (error) {
			// console.error(`ChromeExtensionClient: Error sending message to client: ${error}`)
			throw error
		}
	}

	waitForResponse(requestId, command, timeoutMs = 60000) {
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
		})
	}

	isLaunched() {
		return !!this.wss && !!this.clientSocket && this.isReady
	}

	getCurrentUrl() {
		return this.currentUrl
	}

	async navigate(url) {
		const command = "navigateToUrl"

		try {
			// 简化导航消息，不再传递标签页ID
			const payload = { url }

			const requestId = this.sendMessageToClient(payload, command)
			// 对导航使用更长的超时时间
			const responseData = await this.waitForResponse(requestId, command, 60000)

			// 更新内部URL状态
			if (responseData?.currentUrl) {
				this.currentUrl = responseData.currentUrl
			} else if (responseData?.url) {
				this.currentUrl = responseData.url
			}

			return {
				status: "success",
				message: `Navigated to ${url}. Current URL: ${this.currentUrl}`,
				screenshot: responseData?.screenshot,
				currentUrl: this.currentUrl,
				tabId: responseData?.tabId,
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

		if (!this.isLaunched()) {
			return {
				status: "error",
				message: "Client not connected.",
			}
		}

		try {
			const requestId = this.sendMessageToClient({ coordinate }, command)
			const responseData = await this.waitForResponse(requestId, command, 30000)

			// 更新内部URL状态
			if (responseData?.currentUrl) {
				this.currentUrl = responseData.currentUrl
			}

			// 处理点击后可能打开的新标签页
			if (responseData?.newTabOpened) {
				// 更新新标签页的URL
				if (responseData.newTabUrl) {
					this.currentUrl = responseData.newTabUrl
				}

				return {
					status: "success",
					message: `Clicked at ${coordinate} and opened new tab`,
					screenshot: responseData?.screenshot,
					currentUrl: this.currentUrl,
					newTabOpened: true,
					newTabId: responseData.newTabId,
					currentMousePosition: coordinate,
				}
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

		if (!this.isLaunched()) {
			return {
				status: "error",
				message: "Client not connected.",
			}
		}

		try {
			const requestId = this.sendMessageToClient({ text }, command)
			const responseData = await this.waitForResponse(requestId, command, 7000 + text.length * 10)

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

		if (!this.isLaunched()) {
			return {
				status: "error",
				message: "Client not connected.",
			}
		}

		try {
			const requestId = this.sendMessageToClient({ key }, command)
			const responseData = await this.waitForResponse(requestId, command, 30000)

			// 更新内部URL状态
			if (responseData?.currentUrl) {
				this.currentUrl = responseData.currentUrl
			}

			// 处理按键后可能打开的新标签页
			if (responseData?.newTabOpened) {
				return {
					status: "success",
					message: `Pressed key: ${key} and opened new tab`,
					screenshot: responseData?.screenshot,
					currentUrl: this.currentUrl,
					newTabOpened: true,
					newTabId: responseData.newTabId,
					...(responseData.navigationOccurred !== undefined && { navigationOccurred: responseData.navigationOccurred }),
				}
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

		if (!this.isLaunched()) {
			return {
				status: "error",
				message: "Client not connected.",
			}
		}

		try {
			const requestId = this.sendMessageToClient({}, command)
			const responseData = await this.waitForResponse(requestId, command, 15000)

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

		if (!this.isLaunched()) {
			return {
				status: "error",
				message: "Client not connected.",
			}
		}

		try {
			const requestId = this.sendMessageToClient({}, command)
			const responseData = await this.waitForResponse(requestId, command, 20000)

			if (responseData?.htmlContent) {
				const htmlContent = responseData.htmlContent

				// 创建临时目录保存HTML
				const tempDir = path.join(os.tmpdir(), "chrome_extension_mcp")
				await fs.ensureDir(tempDir)

				// 使用固定的临时文件路径，同时也支持自定义文件名
				const actualFilename = filename || "page.html"
				const fullHtmlPath = filename ? path.join(tempDir, actualFilename) : tempHtmlPath

				await fs.writeFile(fullHtmlPath, htmlContent, "utf8")

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

		if (!this.isLaunched() && !this.wss) {
			return {
				status: "success",
				message: "Browser session already inactive.",
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
			console.error("WebSocket服务器未初始化，无需关闭")
			return // 已经释放，无需操作
		}

		console.error("WebSocket服务器正在关闭...")
		const disposeError = new Error("Client disposed.")
		this.pendingRequests.forEach((req) => {
			clearTimeout(req.timeoutId)
			req.reject(disposeError)
		})
		this.pendingRequests.clear()

		// 强制关闭所有客户端连接
		if (this.wss) {
			// 获取所有连接的客户端并强制关闭
			let clientCount = 0
			this.wss.clients.forEach((client) => {
				clientCount++
				try {
					console.error(`正在强制关闭客户端连接 #${clientCount}...`)
					client.terminate() // 使用terminate而不是close进行强制关闭
					console.error(`客户端连接 #${clientCount} 已强制关闭`)
				} catch (e) {
					console.error(`关闭客户端连接 #${clientCount} 时出错:`, e.message)
				}
			})
			console.error(`共处理了 ${clientCount} 个WebSocket客户端连接`)
		} else {
			console.error("WebSocket服务器实例不存在，跳过客户端连接关闭")
		}

		// 重置客户端连接
		if (this.clientSocket) {
			try {
				console.error("正在关闭主客户端连接...")
				this.clientSocket.terminate ? this.clientSocket.terminate() : this.clientSocket.close()
				console.error("主客户端连接已关闭")
			} catch (e) {
				console.error("关闭主客户端连接时出错:", e.message)
			}
			this.clientSocket = null
		} else {
			console.error("主客户端连接不存在，跳过关闭")
		}

		// 设置已经关闭标记
		this.isReady = false

		// 带超时的服务器关闭
		return new Promise((resolve) => {
			// 添加超时处理，避免关闭卡住
			const forceCloseTimeout = setTimeout(() => {
				console.error("WebSocket服务器关闭超时，强制清除引用")
				if (this.wss) {
					console.error("WebSocket服务器未正常关闭，正在强制终止")
					// 强制释放WebSocket对象
					try {
						// 尝试再次关闭
						this.wss.close(() => {
							console.error("延迟关闭-WebSocket服务器已关闭")
						})
					} catch (e) {
						console.error("强制关闭WebSocket服务器时出错:", e.message)
					}
				}
				this.wss = null
				resolve()
			}, 2000) // 2秒后强制关闭

			if (this.wss) {
				console.error("正在关闭WebSocket服务器...")
				try {
					this.wss.close((err) => {
						clearTimeout(forceCloseTimeout)
						if (err) {
							console.error("WebSocket服务器关闭时出错:", err.message)
						} else {
							console.error("WebSocket服务器已正常关闭")
						}
						this.wss = null
						resolve()
					})
				} catch (err) {
					clearTimeout(forceCloseTimeout)
					console.error("启动WebSocket服务器关闭时出错:", err.message)
					this.wss = null
					resolve()
				}
			} else {
				clearTimeout(forceCloseTimeout)
				console.error("WebSocket服务器实例不存在，无需关闭")
				resolve()
			}
		})
	}

	// 修改onConnected方法，移除对targetTabId的引用
	onConnected() {
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
		const command = "wait"

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

			// 直接发送wait命令到扩展
			const requestId = this.sendMessageToClient({ seconds: waitTime }, command)
			const responseData = await this.waitForResponse(requestId, command, waitTime * 1000 + 5000) // 等待时间 + 5秒缓冲

			// 更新内部URL状态
			if (responseData?.currentUrl) {
				this.currentUrl = responseData.currentUrl
			}

			return {
				status: "success",
				message: `Waited for ${waitTime} seconds`,
				screenshot: responseData?.screenshot,
				currentUrl: this.currentUrl,
			}
		} catch (error) {
			return {
				status: "error",
				message: `Wait error: ${error.message}`,
			}
		}
	}

	/**
	 * 获取所有标签页的列表
	 * @returns {Promise<Object>} 标签页列表结果
	 */
	async tabList() {
		const command = "listTabs"

		try {
			if (!this.isLaunched()) {
				return {
					status: "error",
					message: "Client not connected.",
				}
			}

			const requestId = this.sendMessageToClient({}, command)
			const responseData = await this.waitForResponse(requestId, command, 5000)

			return {
				status: "success",
				message: "Tab list retrieved successfully",
				tabs: responseData?.tabs || [],
				currentTabId: responseData?.currentTabId,
				screenshot: responseData?.screenshot,
			}
		} catch (error) {
			return {
				status: "error",
				message: `Get tab list error: ${error.message}`,
			}
		}
	}

	/**
	 * 创建新标签页
	 * @param {string} url - 可选的URL，如果提供则在新标签页中打开
	 * @returns {Promise<Object>} 新标签页结果
	 */
	async tabNew(url = "") {
		const command = "newTab"

		try {
			if (!this.isLaunched()) {
				return {
					status: "error",
					message: "Client not connected.",
				}
			}

			const requestId = this.sendMessageToClient({ url }, command)
			const responseData = await this.waitForResponse(requestId, command, 30000)

			// 更新URL
			if (responseData?.currentUrl) {
				this.currentUrl = responseData.currentUrl
			} else if (responseData?.url && url) {
				this.currentUrl = url
			}

			return {
				status: "success",
				message: url ? `New tab created and navigated to ${url}` : "New blank tab created",
				tabId: responseData?.tabId,
				currentUrl: this.currentUrl,
				screenshot: responseData?.screenshot,
			}
		} catch (error) {
			return {
				status: "error",
				message: `Create new tab error: ${error.message}`,
			}
		}
	}

	/**
	 * 选择并切换到指定索引的标签页
	 * @param {number} index - 标签页索引
	 * @returns {Promise<Object>} 标签页切换结果
	 */
	async tabSelect(index) {
		const command = "selectTab"

		try {
			if (!this.isLaunched()) {
				return {
					status: "error",
					message: "Client not connected.",
				}
			}

			// 验证输入
			const tabIndex = Number(index)
			if (isNaN(tabIndex) || tabIndex < 0) {
				return {
					status: "error",
					message: `Invalid tab index: ${index}. Must be a non-negative number.`,
				}
			}

			const requestId = this.sendMessageToClient({ index: tabIndex }, command)
			const responseData = await this.waitForResponse(requestId, command, 10000)

			// 更新当前URL
			if (responseData?.currentUrl) {
				this.currentUrl = responseData.currentUrl
			}

			return {
				status: "success",
				message: `Switched to tab at index ${tabIndex}`,
				tabId: responseData?.tabId,
				currentUrl: this.currentUrl,
				screenshot: responseData?.screenshot,
			}
		} catch (error) {
			return {
				status: "error",
				message: `Select tab error: ${error.message}`,
			}
		}
	}

	/**
	 * 关闭指定索引的标签页
	 * @param {number} index - 可选的标签页索引，如果不提供则关闭当前标签页
	 * @returns {Promise<Object>} 标签页关闭结果
	 */
	async tabClose(index) {
		const command = "closeTab"

		try {
			if (!this.isLaunched()) {
				return {
					status: "error",
					message: "Client not connected.",
				}
			}

			// 构建参数，仅当提供索引时包含
			const params = {}
			if (index !== undefined) {
				// 验证输入
				const tabIndex = Number(index)
				if (isNaN(tabIndex) || tabIndex < 0) {
					return {
						status: "error",
						message: `Invalid tab index: ${index}. Must be a non-negative number.`,
					}
				}
				params.index = tabIndex
			}

			const requestId = this.sendMessageToClient(params, command)
			const responseData = await this.waitForResponse(requestId, command, 10000)

			// 更新当前URL
			if (responseData?.currentUrl) {
				this.currentUrl = responseData.currentUrl
			}

			return {
				status: "success",
				message: index !== undefined ? `Closed tab at index ${index}` : "Closed current tab",
				tabId: responseData?.tabId,
				currentUrl: this.currentUrl,
				screenshot: responseData?.screenshot,
			}
		} catch (error) {
			return {
				status: "error",
				message: `Close tab error: ${error.message}`,
			}
		}
	}

	async pressKeyCombination(combination) {
		const command = "pressKeyCombination"

		if (!this.isLaunched()) {
			return {
				status: "error",
				message: "Client not connected.",
			}
		}

		try {
			const requestId = this.sendMessageToClient({ combination }, command)
			const responseData = await this.waitForResponse(requestId, command, 15000)

			// 更新内部URL状态
			if (responseData?.currentUrl) {
				this.currentUrl = responseData.currentUrl
			}

			// 处理按键后可能打开的新标签页
			if (responseData?.newTabOpened) {
				return {
					status: "success",
					message: `Pressed key combination: ${combination} and opened new tab`,
					screenshot: responseData?.screenshot,
					currentUrl: this.currentUrl,
					newTabOpened: true,
					newTabId: responseData.newTabId,
					...(responseData.navigationOccurred !== undefined && { navigationOccurred: responseData.navigationOccurred }),
				}
			}

			return {
				status: "success",
				message: `Pressed key combination: ${combination}`,
				screenshot: responseData?.screenshot,
				currentUrl: this.currentUrl,
				...(responseData.navigationOccurred !== undefined && { navigationOccurred: responseData.navigationOccurred }),
			}
		} catch (error) {
			// console.error(`ChromeExtensionClient: Error during ${command}: ${error.message}`)
			return {
				status: "error",
				message: `Press key combination error: ${error.message}`,
				screenshot: error.screenshot,
			}
		}
	}

	/**
	 * 执行批处理操作序列
	 * @param {Array} operations - 操作序列
	 * @param {number} intervalMs - 操作间隔(毫秒)
	 * @returns {Promise<Object>} 执行结果
	 */
	async batch(operations, intervalMs = 500) {
		const command = "batch"

		if (!this.isLaunched()) {
			return {
				status: "error",
				message: "Client not connected.",
			}
		}

		try {
			const requestId = this.sendMessageToClient(
				{
					operations,
					interval_ms: intervalMs,
				},
				command,
			)

			const responseData = await this.waitForResponse(requestId, command, 60000) // 使用较长的超时时间

			// 更新内部URL状态
			if (responseData?.currentUrl) {
				this.currentUrl = responseData.currentUrl
			}

			return {
				status: "success",
				message: responseData.message || `Executed batch of ${operations.length} operations`,
				operations: responseData.operations,
				screenshot: responseData.screenshot,
				currentUrl: this.currentUrl,
				tabId: responseData.tabId,
			}
		} catch (error) {
			return {
				status: "error",
				message: `Batch operation error: ${error.message}`,
				screenshot: error.screenshot,
			}
		}
	}
}
