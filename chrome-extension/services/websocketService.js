import { handleCommandFromServer } from "../handlers/commandHandlers.js"
import { detachDebuggerIfNeeded } from "./debuggerService.js"
import { captureVisibleTabPromise } from "./screenshotService.js"
import { handleRecordingCommand } from "../background.js"
import { viewportConfig } from "./viewportService.js"

// WebSocket连接配置
const WEBSOCKET_URL = "ws://localhost:9876"
let ws = null
let reconnectInterval = 5000 // 重连间隔5秒
let reconnectTimer = null
let isConnected = false
let connectionAttempts = 0
const RECONNECT_DELAY = 5000

// 添加性能分析相关内容
// 保存命令开始时间的映射
const commandStartTimes = new Map()

/**
 * 开始计时特定命令
 * @param {string} requestId - 请求ID
 * @param {string} command - 命令名称
 */
export function startCommandTiming(requestId, command) {
	const startTime = performance.now()
	commandStartTimes.set(requestId, {
		startTime,
		command,
		steps: [],
	})
	console.log(`[PERF] 开始处理命令: ${command} (${requestId}) @ ${new Date().toISOString()}`)
}

/**
 * 记录命令处理步骤时间
 * @param {string} requestId - 请求ID
 * @param {string} stepName - 步骤名称
 */
export function recordCommandStep(requestId, stepName) {
	if (!commandStartTimes.has(requestId)) return

	const data = commandStartTimes.get(requestId)
	const now = performance.now()
	const elapsed = now - data.startTime

	data.steps.push({
		name: stepName,
		time: now,
		elapsed,
	})

	console.log(`[PERF] ${data.command} (${requestId}) - ${stepName}: ${elapsed.toFixed(2)}ms`)
}

/**
 * 结束计时并记录总时间
 * @param {string} requestId - 请求ID
 */
export function endCommandTiming(requestId) {
	if (!commandStartTimes.has(requestId)) return

	const data = commandStartTimes.get(requestId)
	const endTime = performance.now()
	const totalTime = endTime - data.startTime

	console.log(`[PERF] 完成命令: ${data.command} (${requestId}) - 总耗时: ${totalTime.toFixed(2)}ms`)

	// 在步骤超过一定数量时打印详细步骤信息
	if (data.steps.length > 2) {
		console.log(`[PERF] ${data.command} (${requestId}) 详细步骤:`)
		data.steps.forEach((step, index) => {
			const prevTime = index === 0 ? data.startTime : data.steps[index - 1].time
			const stepDuration = step.time - prevTime
			console.log(`  ${index + 1}. ${step.name}: ${stepDuration.toFixed(2)}ms (总计: ${step.elapsed.toFixed(2)}ms)`)
		})
	}

	// 删除已完成的计时数据
	commandStartTimes.delete(requestId)
}

/**
 * 连接到WebSocket服务器
 */
export function connectWebSocket() {
	if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
		console.log("[BG_WS] WebSocket already connecting or open.")
		return
	}

	if (reconnectTimer) {
		clearTimeout(reconnectTimer)
		reconnectTimer = null
	}

	console.log(`[BG_WS] Attempting to connect to WebSocket server: ${WEBSOCKET_URL}`)
	try {
		ws = new WebSocket(WEBSOCKET_URL)
		connectionAttempts++

		ws.onopen = (event) => {
			console.log("[BG_WS] WebSocket connection opened.", event)
			isConnected = true
			connectionAttempts = 0 // 重置尝试计数
			// 重置重连间隔
			reconnectInterval = 5000

			// 连接建立后，发送当前viewport配置到服务器，用于同步
			setTimeout(() => {
				sendMessageToServer({
					command: "viewportSync",
					viewport: viewportConfig,
					message: "Chrome扩展默认viewport配置",
					source: "chromeExtension",
				})
				console.log("[BG_WS] 已发送viewport配置同步消息:", viewportConfig)
			}, 1000) // 延迟1秒发送，确保连接稳定
		}

		ws.onmessage = (event) => {
			console.log("[BG_WS] Message received from server:", event.data)

			try {
				const parsedMessage = JSON.parse(event.data)

				// 开始计时
				if (parsedMessage.command && parsedMessage.requestId) {
					startCommandTiming(parsedMessage.requestId, parsedMessage.command)
				}

				// 过滤掉带有自己来源的消息
				if (parsedMessage.source === "chromeExtension") {
					console.warn("[BG_WS] Ignoring message with own source.")
					return
				}

				// 检查是否是录制相关命令
				if (parsedMessage.command === "startRecording" || parsedMessage.command === "stopRecording") {
					// 直接打印命令类型，方便调试
					console.log(`[BG_WS] 接收到${parsedMessage.command}命令，开始处理`)

					// 如果是停止录制，添加更多日志
					if (parsedMessage.command === "stopRecording") {
						console.log("[BG_WS] 即将处理停止录制命令")
					}

					// 创建安全的响应函数
					const safeResponse = (response) => {
						try {
							// 在发送前记录响应内容
							console.log(`[BG_WS] 发送录制命令响应:`, response)

							// 添加请求ID后发送
							sendMessageToServer({
								...response,
								requestId: parsedMessage.requestId,
							})

							// 如果是停止录制的成功响应，确保会话数据完整
							if (parsedMessage.command === "stopRecording" && response.status === "success") {
								console.log(
									"[BG_WS] 停止录制成功，校验会话数据:",
									response.session ? "会话数据完整" : "无会话数据",
								)
							}
						} catch (error) {
							console.error("[BG_WS] 发送响应时出错:", error)

							// 尝试发送简化的错误响应
							try {
								sendMessageToServer({
									status: "error",
									message: "发送响应时出错: " + error.message,
									requestId: parsedMessage.requestId,
									source: "chromeExtension",
								})
							} catch (e) {
								console.error("[BG_WS] 无法发送错误响应:", e)
							}
						}
					}

					// 使用同步调用方式处理录制命令 - 避免异步问题
					handleRecordingCommand(parsedMessage, safeResponse)
				} else {
					// 处理其他命令
					handleCommandFromServer(parsedMessage)
				}
			} catch (e) {
				console.error("[BG_WS] Error parsing message from server:", e, "Raw:", event.data)
			}
		}

		ws.onerror = (event) => {
			console.error("[BG_WS] WebSocket error observed:", event)
			// 错误通常在close之前，重连会在close处理
		}

		ws.onclose = async (event) => {
			console.log(
				`[BG_WS] WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason}, Was clean: ${event.wasClean}`,
			)
			await detachDebuggerIfNeeded()
			ws = null
			isConnected = false

			console.log(`[BG_WS] 将在${RECONNECT_DELAY}ms后尝试重连 (尝试次数 ${connectionAttempts})`)
			reconnectTimer = setTimeout(() => {
				connectWebSocket()
			}, RECONNECT_DELAY)
		}

		return true
	} catch (error) {
		console.error("[BG_WS] Error creating WebSocket:", error)
		ws = null
		isConnected = false

		console.log(`[BG_WS] 将在${RECONNECT_DELAY}ms后尝试重连 (尝试次数 ${connectionAttempts})`)
		reconnectTimer = setTimeout(() => {
			connectWebSocket()
		}, RECONNECT_DELAY)

		return false
	}
}

/**
 * 向WebSocket服务器发送消息
 * @param {Object} message - 要发送的消息对象
 */
export function sendMessageToServer(message) {
	if (ws && ws.readyState === WebSocket.OPEN) {
		try {
			// 如果是响应消息，记录结束时间
			if (message.requestId && (message.status === "ack" || message.status === "success" || message.status === "error")) {
				endCommandTiming(message.requestId)
			}

			// 添加消息来源标记
			message.source = "chromeExtension"
			console.log("[BG_WS] Sending message to server:", message)
			ws.send(JSON.stringify(message))
			return true
		} catch (error) {
			console.error("[BG_WS] Error sending message to server:", error)
			return false
		}
	} else {
		console.error("[BG_WS] Cannot send message: WebSocket not open. State:", ws?.readyState)
		return false
	}
}

/**
 * 发送错误响应
 * @param {string} requestId - 请求ID
 * @param {string} command - 命令名称
 * @param {Error} error - 错误对象
 */
export async function sendErrorResponse(requestId, command, error) {
	console.error(`[BG_WS] Error processing ${command} command (request: ${requestId}):`, error)

	// 尝试在错误时也捕获屏幕截图
	const screenshotOnError = await captureVisibleTabPromise(null).catch((e) => {
		console.error(`[BG_WS] Failed to capture screenshot on ${command} error:`, e)
		return null
	})

	sendMessageToServer({
		status: "error",
		command: command,
		requestId: requestId,
		message: error.message || String(error),
		screenshot: screenshotOnError,
	})
}

/**
 * 关闭WebSocket连接
 * @returns {Promise<void>} 返回promise，在WebSocket成功关闭后解析
 */
export async function closeWebSocket() {
	console.log("[BG_WS] 主动关闭WebSocket连接")

	// 清除重连定时器
	if (reconnectTimer) {
		clearTimeout(reconnectTimer)
		reconnectTimer = null
	}

	// 关闭WebSocket连接
	if (ws) {
		if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
			return new Promise((resolve) => {
				// 设置onclose处理器，确保在关闭后解析promise
				const originalOnClose = ws.onclose
				ws.onclose = (event) => {
					// 调用原始onclose处理器
					if (originalOnClose) {
						originalOnClose.call(ws, event)
					}

					console.log("[BG_WS] WebSocket连接已手动关闭")
					ws = null
					isConnected = false
					resolve()
				}

				// 关闭连接
				ws.close(1000, "Manual close")

				// 以防onclose不触发，设置超时
				setTimeout(() => {
					if (ws) {
						console.warn("[BG_WS] WebSocket关闭超时，强制重置")
						ws = null
						isConnected = false
					}
					resolve()
				}, 2000)
			})
		} else {
			// 已经关闭或正在关闭
			ws = null
			isConnected = false
		}
	}

	// 如果没有WebSocket，直接返回
	return Promise.resolve()
}

/**
 * 处理录制命令后的资源清理
 * @param {Object} message - 消息对象
 * @param {Function} sendResponse - 响应函数
 * @returns {Promise<boolean>} 是否处理了消息
 */
export async function handleRecordingComplete(message, sendResponse) {
	// 仅对stopRecording命令执行额外清理
	if (message.command === "stopRecording") {
		try {
			// 发送最终响应
			sendResponse({
				status: "success",
				message: "录制已成功停止，资源已清理",
				...message, // 保留原始消息中的其他字段
			})

			// 主动关闭并重新连接WebSocket服务器
			await closeWebSocket()

			// 延迟重新连接
			setTimeout(() => {
				connectWebSocket()
			}, 1000)

			return true
		} catch (error) {
			console.error("[BG_WS] 处理录制完成时出错:", error)
		}
	}
	return false
}

/**
 * 检查WebSocket是否已连接
 * @returns {boolean} 是否已连接
 */
export function isWebSocketConnected() {
	return isConnected && ws && ws.readyState === WebSocket.OPEN
}
