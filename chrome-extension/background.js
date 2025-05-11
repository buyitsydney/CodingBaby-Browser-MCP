/// <reference types="chrome" />

import { connectWebSocket, closeWebSocket, sendMessageToServer } from "./services/websocketService.js"
import { initTabListeners } from "./services/tabService.js"
import { initDebuggerListeners } from "./services/debuggerService.js"
import {
	ensureVisualizationInitialized,
	cleanupVisualization,
	markTabInitialized,
	isTabInitialized,
} from "./handlers/visualizationHandler.js"

// 跟踪已经注册监听器的标签页
const tabListenersRegistered = new Set()
// 注意：不再需要重复定义initializedTabs，因为我们从visualizationHandler.js中导入markTabInitialized函数

// ========== 录制功能相关变量 ==========
let isRecording = false
let recordSession = null
let lastScreenshot = null
let pendingActions = []
// 保存录制会话的标题和任务描述，用于新标签页加入录制
let currentRecordingSessionTitle = ""
let currentRecordingTaskDescription = ""
// 保存最后活跃的标签页ID
let lastActiveTabId = null

// 添加截图节流控制变量
let lastScreenshotTime = 0
const MIN_SCREENSHOT_INTERVAL = 1000 // 每秒最多一次截图

// 保存上一次记录的时间（按操作类型）
const lastActionTimestamps = new Map()
const MIN_ACTION_INTERVAL = 500 // 同类型操作至少间隔500毫秒

// 初始化录制会话 - 确保只初始化一次
function initRecordSession(title, task) {
	// 添加日志，显示当前状态
	console.log(`[BG] 初始化录制前状态: isRecording=${isRecording}, recordSession存在=${recordSession !== null}`)

	// 避免重复初始化
	if (recordSession !== null && isRecording === true) {
		console.log("[BG] 录制会话已存在，跳过重复初始化")
		return recordSession
	}

	console.log("[BG] 初始化录制会话:", title)

	// 确保设置正确的录制状态
	isRecording = true
	recordSession = {
		id: "session-" + Date.now(),
		title: title || "未命名会话",
		task: task || "未指定任务",
		createdAt: Date.now(),
		actions: [],
		// 添加会话状态信息
		state: {
			initialized: true,
			startTime: Date.now(),
		},
	}
	pendingActions = []

	// 记录当前活跃标签页
	trackActiveTab()

	// 添加状态检查
	console.log(`[BG] 录制会话初始化完成: ID=${recordSession.id}, isRecording=${isRecording}`)

	return recordSession
}

// 跟踪活跃标签页
function trackActiveTab() {
	chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
		if (tabs && tabs.length > 0) {
			lastActiveTabId = tabs[0].id
			console.log(`[BG] 更新活跃标签页ID: ${lastActiveTabId}`)
		}
	})
}

// 添加标签页活跃状态变化监听
chrome.tabs.onActivated.addListener((activeInfo) => {
	lastActiveTabId = activeInfo.tabId
	console.log(`[BG] 标签页激活: ${lastActiveTabId}`)
})

// 清理所有录制资源的函数
function cleanupRecordingResources() {
	console.log("[BG] 清理录制资源")

	// 保存当前状态用于日志
	const oldState = {
		isRecording: isRecording,
		hasSession: recordSession !== null,
		sessionId: recordSession?.id || "无",
	}

	// 重置录制状态
	isRecording = false
	recordSession = null
	pendingActions = []
	lastScreenshot = null
	currentRecordingSessionTitle = ""
	currentRecordingTaskDescription = ""

	// 清理时间戳记录
	lastActionTimestamps.clear()

	console.log(`[BG] 录制状态已重置：之前=${JSON.stringify(oldState)}, 之后=isRecording:false`)

	// 通知所有标签页停止录制 - 确保所有标签页都收到停止命令
	try {
		chrome.tabs.query({}, (tabs) => {
			const initializedTabIds = tabs.map((tab) => tab.id).filter((tabId) => isTabInitialized(tabId))

			console.log(`[BG] 通知 ${initializedTabIds.length} 个标签页清理录制资源`)

			for (const tabId of initializedTabIds) {
				chrome.tabs.sendMessage(tabId, { command: "STOP_RECORDING" }).catch((error) => {
					// 忽略错误，只是尝试清理
				})
			}
		})
	} catch (error) {
		// 忽略清理过程中的错误，确保功能可继续
		console.error("[BG] 清理资源时遇到错误:", error)
	}
}

// 检查录制状态
function isRecordingActive() {
	// 更严格的检查，确保所有需要的状态都存在
	const result = isRecording === true && recordSession !== null && typeof recordSession === "object"
	//console.log(`[BG] 检查录制状态: isRecording=${isRecording}, recordSession存在=${recordSession !== null}, 结果=${result}`)
	return result
}

// 捕获当前标签截图 - 改进为使用指定标签页或最后活跃标签页
async function captureCurrentTab() {
	try {
		const now = Date.now()
		const timeElapsed = now - lastScreenshotTime

		// 如果距离上次截图时间不足MIN_SCREENSHOT_INTERVAL，则跳过截图
		if (timeElapsed < MIN_SCREENSHOT_INTERVAL) {
			if (lastScreenshot) {
				return lastScreenshot
			}
			// 生成一个空白图片作为兜底，确保不会因截图失败而中断录制流程
			return "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q=="
		}

		// 查找可用的标签页进行截图
		let targetTabId = null

		// 首先尝试使用最后活跃的标签页
		if (lastActiveTabId) {
			try {
				// 检查该标签页是否仍然存在
				await chrome.tabs.get(lastActiveTabId)
				targetTabId = lastActiveTabId
			} catch (e) {
				// 标签页不存在，忽略错误
			}
		}

		// 如果没有有效的目标标签页，查询所有初始化过的标签页
		if (!targetTabId) {
			const tabs = await chrome.tabs.query({})
			const initializedTabIds = tabs.map((tab) => tab.id).filter((tabId) => isTabInitialized(tabId))

			if (initializedTabIds.length > 0) {
				targetTabId = initializedTabIds[0] // 使用第一个初始化过的标签页
			}
		}

		// 如果仍然没有找到可用标签页，返回一个空白图片
		if (!targetTabId) {
			console.warn("[BG] 未找到可用标签页进行截图，使用空白图片代替")
			// 生成一个空白图片作为兜底
			const emptyImage =
				"data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q=="
			lastScreenshot = emptyImage
			lastScreenshotTime = Date.now()
			return emptyImage
		}

		return new Promise((resolve) => {
			// 使用jpeg格式并降低质量，大幅减小图片大小
			const options = {
				format: "jpeg", // 改用jpeg代替png
				quality: 30, // 质量降低到30%，大幅减小文件
			}

			// 使用特定的标签页ID而不是null(当前活动标签页)
			chrome.tabs.captureVisibleTab(null, options, (dataUrl) => {
				if (chrome.runtime.lastError) {
					// 如果捕获当前窗口失败，使用空白图片
					console.warn("[BG] 当前窗口截图失败，使用空白图片代替")

					// 生成空白图片
					const emptyImage =
						"data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q=="
					lastScreenshot = emptyImage
					lastScreenshotTime = Date.now()
					resolve(emptyImage)
				} else {
					lastScreenshot = dataUrl
					lastScreenshotTime = Date.now()
					resolve(dataUrl)
				}
			})
		})
	} catch (error) {
		// 出错时返回空白图片，确保录制过程不会中断
		console.error("[BG] 捕获截图异常:", error)
		// 生成一个空白图片作为兜底
		const emptyImage =
			"data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q=="
		lastScreenshot = emptyImage
		lastScreenshotTime = Date.now()
		return emptyImage
	}
}

/**
 * 缩放图片以减小尺寸 (使用适用于Service Worker的方法)
 * @param {string} dataUrl - 原始图片的dataURL
 * @param {number} scale - 缩放比例，如0.7表示缩放到原来的70%
 * @returns {Promise<string>} - 返回缩放后的dataURL
 */
function resizeImage(dataUrl, scale) {
	return new Promise((resolve, reject) => {
		// Service Worker环境中无法使用document和canvas，直接使用更低质量的JPEG
		// 我们只降低质量，不进行缩放
		try {
			// 为了在Service Worker中简单处理，我们只降低质量，不缩放尺寸
			// 创建一个低质量的blob url
			const byteString = atob(dataUrl.split(",")[1])
			const mimeString = dataUrl.split(",")[0].split(":")[1].split(";")[0]
			const ab = new ArrayBuffer(byteString.length)
			const ia = new Uint8Array(ab)

			for (let i = 0; i < byteString.length; i++) {
				ia[i] = byteString.charCodeAt(i)
			}

			// 原始图片Blob
			const blob = new Blob([ab], { type: mimeString })

			// 直接返回原始dataUrl，但记录大小变化
			const originalSizeKB = Math.round(dataUrl.length / 1024)
			console.log(`[BG] 图片处理: 原始大小${originalSizeKB}KB，Service Worker环境不支持Canvas缩放，使用降低质量的方法`)

			// 我们将在captureCurrentTab中直接使用质量更低的JPEG格式
			resolve(dataUrl)
		} catch (error) {
			console.error("[BG] 图片缩放出错:", error)
			resolve(dataUrl) // 出错时直接返回原图
		}
	})
}

// 完成操作记录（添加截图后后）
async function finalizeAction(action) {
	// 捕获操作后截图
	const screenshotAfter = await captureCurrentTab()
	if (screenshotAfter) {
		action.screenshotAfter = screenshotAfter

		// 添加到会话中
		if (recordSession) {
			recordSession.actions.push(action)
			// 减少每次操作记录日志，只在需要时输出
			// console.log(`[BG] 记录操作: ${action.actionType}`)
		}
	} else {
		// 保留错误日志
		console.error("[BG] 无法完成操作记录：截图失败")
		// 即使没有截图也添加操作记录
		if (recordSession) {
			recordSession.actions.push(action)
			// 减少操作记录日志
			// console.log(`[BG] 记录操作(无后截图): ${action.actionType}`)
		}
	}
}

// 增加会话状态更新函数
function updateRecordSessionState(key, value) {
	if (recordSession && typeof recordSession === "object") {
		if (!recordSession.state) {
			recordSession.state = {}
		}
		recordSession.state[key] = value
		return true
	}
	return false
}

// 处理操作记录
async function handleActionRecord(message) {
	// 添加详细状态检查日志
	const recordingState = isRecordingActive()
	console.log(`[BG] 处理操作记录: 类型=${message.actionType}, 录制状态=${recordingState}, 会话ID=${recordSession?.id || "无"}`)

	if (!recordingState) {
		console.warn(`[BG] 收到操作但未开始录制: ${message.actionType}`)
		return
	}

	try {
		// 更新会话状态，标记最后活动时间
		updateRecordSessionState("lastActivityTime", Date.now())
		updateRecordSessionState("lastActionType", message.actionType)

		const actionType = message.actionType
		const now = Date.now()

		// 对于相同类型的操作进行节流
		if (lastActionTimestamps.has(actionType)) {
			const lastTime = lastActionTimestamps.get(actionType)
			const timeSinceLastAction = now - lastTime

			// 如果同类型操作间隔太短，跳过记录（但pageload总是记录）
			if (timeSinceLastAction < MIN_ACTION_INTERVAL && actionType !== "pageload") {
				console.log(`[BG] 操作节流：跳过${timeSinceLastAction}ms内的重复${actionType}操作`)
				return
			}
		}

		// 更新该类型操作的最后记录时间
		lastActionTimestamps.set(actionType, now)

		// 准备操作数据
		const action = {
			timestamp: message.timestamp,
			actionType: message.actionType,
			params: message.params || {},
			description: "", // 默认描述，可以通过UI更新
		}

		// 只有在能够获取截图时才添加截图
		const beforeScreenshot = lastScreenshot || (await captureCurrentTab())
		if (beforeScreenshot) {
			action.screenshotBefore = beforeScreenshot
		}

		// 添加到待处理队列
		pendingActions.push(action)

		// 设置延迟处理，等待操作完成
		setTimeout(async () => {
			// 再次检查录制状态，确保仍在录制中
			if (!isRecordingActive()) {
				console.warn("[BG] 尝试完成操作记录，但录制已停止")
				return
			}

			const pendingAction = pendingActions.shift()
			if (pendingAction) {
				await finalizeAction(pendingAction)
			}
		}, 500)
	} catch (error) {
		console.error("[BG] 处理操作记录异常:", error)
	}
}

// 停止录制并返回会话数据
function stopRecording() {
	if (!isRecordingActive()) {
		console.error("[BG] 尝试停止不存在的录制会话")
		return null
	}

	// 复制会话数据
	let sessionData = null
	try {
		if (recordSession) {
			sessionData = JSON.parse(JSON.stringify(recordSession))
			console.log(`[BG] 录制会话数据保存成功，共有操作: ${sessionData.actions?.length || 0}`)
		}
	} catch (error) {
		console.error("[BG] 保存录制会话数据时出错:", error)
	}

	// 重置录制状态 - 确保释放所有资源
	cleanupRecordingResources()

	return sessionData
}

// 扩展启动入口点
function initializeExtension() {
	console.log("[BG] Background service worker started.")

	// 确保清理录制资源
	console.log("[BG] 初始化时清理之前的录制资源")
	cleanupRecordingResources()

	// 初始化标签监听器
	initTabListeners()

	// 初始化调试器监听器
	initDebuggerListeners()

	// 立即检查现有标签页 - 简化日志输出
	chrome.tabs.query({}, (tabs) => {
		console.log(`[BG] 当前共有 ${tabs.length} 个标签页打开，正在进行初始化...`)

		// 过滤掉不支持的标签页
		const supportedTabs = tabs.filter(
			(tab) => tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("chrome-extension://"),
		)

		if (supportedTabs.length > 0) {
			console.log(`[BG] 将初始化 ${supportedTabs.length} 个支持的标签页`)

			// 为每个支持的标签页初始化内容脚本，但不输出每个标签的详细日志
			supportedTabs.forEach((tab) => {
				setTimeout(() => {
					ensureVisualizationInitialized(tab.id).catch(() => {
						// 忽略初始化错误的详细日志
					})
				}, 1000)
			})
		}
	})

	// 监听标签页创建事件 - 简化日志
	chrome.tabs.onCreated.addListener(async (tab) => {
		// 仅在DEBUG模式或特殊情况下输出
		// console.log(`[BG] 新标签页创建: ${tab.id} (${tab.url || "unknown url"})`)
	})

	// 监听标签页更新事件 - 简化日志
	chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
		// 只有当页面完全加载且没有监听器时才注册
		if (changeInfo.status === "complete" && !tabListenersRegistered.has(tabId)) {
			// 减少日志输出，只记录状态变化
			// console.log(`[BG] 标签页 ${tabId} 加载完成 (${tab.url})`)

			// 注册该标签页的内容脚本通信
			tabListenersRegistered.add(tabId)

			// 在页面加载完成后适当延迟，确保DOM已准备好
			setTimeout(async () => {
				try {
					// 特殊处理 about:blank 页面
					if (tab.url === "about:blank") {
						return
					}

					// 初始化可视化 - 减少日志输出
					await ensureVisualizationInitialized(tabId).catch(() => {
						// 忽略错误日志
					})
				} catch (error) {
					// 仅记录关键错误
					console.error(`[BG] 处理标签页 ${tabId} 更新时出错`)
				}
			}, 500) // 延迟500ms确保页面渲染完成
		}

		// 如果标签页URL变化，可能需要重新初始化 - 简化日志
		if (changeInfo.url && tabListenersRegistered.has(tabId)) {
			// 减少URL变更日志
			// console.log(`[BG] 标签页 ${tabId} URL变更为 ${changeInfo.url}`)

			// 给页面一些时间加载，然后再初始化
			setTimeout(async () => {
				try {
					await ensureVisualizationInitialized(tabId).catch(() => {
						// 忽略错误日志
					})
				} catch (error) {
					// 忽略错误日志
				}
			}, 1000)
		}
	})

	// 监听标签页关闭事件，清理可视化资源 - 简化日志
	chrome.tabs.onRemoved.addListener((tabId) => {
		// 减少关闭标签页日志
		// console.log(`[BG] 标签页 ${tabId} 已关闭`)
		tabListenersRegistered.delete(tabId)
		cleanupVisualization(tabId).catch(() => {
			// 忽略错误日志
		})
	})

	// 监听内容脚本发送的消息 - 简化日志
	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		if (message.type === "visualization_ready" && sender.tab) {
			// 减少就绪日志，只在首次初始化时输出
			const isFirstInit = markTabInitialized(sender.tab.id)

			// 只有首次初始化时才记录日志
			if (isFirstInit) {
				//console.log(`[BG] 标签页 ${sender.tab.id} 可视化初始化完成`)
			}

			// 只有首次初始化时才发送录制命令，避免重复发送
			if (isFirstInit && isRecordingActive() && sender.tab.id) {
				console.log(`[BG] 将标签页 ${sender.tab.id} 加入录制`)
				chrome.tabs
					.sendMessage(sender.tab.id, { command: "START_RECORDING" })
					.then(() => {
						// 减少成功日志
						// console.log(`[BG] 成功将标签页 ${sender.tab.id} 加入录制`)
					})
					.catch((error) => console.error(`[BG] 将标签页 ${sender.tab.id} 加入录制失败:`, error))
			}

			sendResponse({ received: true })
			return true
		}

		// 处理录制相关消息 - 简化日志
		if (message.type === "RECORD_ACTION") {
			// 简化操作日志，仅记录操作类型不记录详情
			// console.log(`[BG] 收到录制操作: ${message.actionType}`)
			handleActionRecord(message)
			sendResponse({ received: true })
			return true
		}

		// 添加紧急停止录制功能
		if (message.type === "FORCE_STOP_RECORDING") {
			console.log("[BG] 收到强制停止录制命令")
			// 不管当前状态如何，直接重置所有录制资源
			cleanupRecordingResources()

			// 尝试重新连接WebSocket
			try {
				closeWebSocket().then(() => {
					setTimeout(connectWebSocket, 1000)
				})
			} catch (e) {}

			sendResponse({
				status: "success",
				message: "录制已强制停止",
			})
			return true
		}

		return false
	})

	// 连接WebSocket服务器
	connectWebSocket()

	// 周期性检查录制状态 - 防止状态不一致
	setInterval(() => {
		// 检查录制状态是否一致
		if (isRecording && !recordSession) {
			console.warn("[BG] 检测到录制状态不一致：isRecording=true但recordSession为空，修复中...")
			isRecording = false // 重置为一致状态
		}

		// 如果录制时间过长(超过2小时)，自动停止录制，避免资源耗尽
		if (isRecordingActive() && recordSession.state && recordSession.state.startTime) {
			const recordingDuration = Date.now() - recordSession.state.startTime
			const MAX_RECORDING_DURATION = 2 * 60 * 60 * 1000 // 2小时

			if (recordingDuration > MAX_RECORDING_DURATION) {
				console.warn(`[BG] 录制时间过长(${Math.round(recordingDuration / 60000)}分钟)，自动停止`)
				// 保存会话数据
				let sessionData = null
				try {
					sessionData = JSON.parse(JSON.stringify(recordSession))
				} catch (e) {}

				// 重置录制状态
				cleanupRecordingResources()

				// 发送超时停止消息到服务器
				if (sessionData) {
					sendMessageToServer({
						status: "warning",
						message: "录制自动停止：时间过长",
						session: sessionData,
						source: "chromeExtension",
					})
				}
			}
		}

		// 如果录制活动超过30分钟无操作，自动停止
		if (isRecordingActive() && recordSession.state && recordSession.state.lastActivityTime) {
			const inactiveTime = Date.now() - recordSession.state.lastActivityTime
			const MAX_INACTIVE_TIME = 30 * 60 * 1000 // 30分钟

			if (inactiveTime > MAX_INACTIVE_TIME) {
				console.warn(`[BG] 录制${Math.round(inactiveTime / 60000)}分钟无操作，自动停止`)
				// 保存会话数据
				let sessionData = null
				try {
					sessionData = JSON.parse(JSON.stringify(recordSession))
				} catch (e) {}

				// 重置录制状态
				cleanupRecordingResources()

				// 发送超时停止消息到服务器
				if (sessionData) {
					sendMessageToServer({
						status: "warning",
						message: "录制自动停止：长时间无操作",
						session: sessionData,
						source: "chromeExtension",
					})
				}
			}
		}
	}, 30000) // 每30秒检查一次

	// 注册紧急停止命令
	chrome.commands.onCommand.addListener((command) => {
		if (command === "stop_recording") {
			console.log("[BG] 收到键盘快捷键停止录制命令")
			if (isRecordingActive()) {
				// 保存会话数据
				let sessionData = null
				try {
					sessionData = JSON.parse(JSON.stringify(recordSession))
				} catch (e) {}

				// 重置录制状态
				cleanupRecordingResources()

				// 发送紧急停止消息到服务器
				if (sessionData) {
					sendMessageToServer({
						status: "success",
						message: "录制通过快捷键紧急停止",
						session: sessionData,
						source: "chromeExtension",
					})
				}
			}
		}
	})
}

// 处理WebSocket接收到的录制控制命令
export function handleRecordingCommand(message, sendResponse) {
	try {
		console.log(`[BG] 收到WebSocket命令: ${message.command}`, message)

		if (message.command === "startRecording") {
			// 开始前先确保清理任何残留资源
			cleanupRecordingResources()

			// 设置全局录制状态
			currentRecordingSessionTitle = message.sessionTitle || "未命名会话"
			currentRecordingTaskDescription = message.taskDescription || ""

			// 开始录制 - 保留关键日志
			// 初始化录制会话会设置isRecording = true
			const session = initRecordSession(currentRecordingSessionTitle, currentRecordingTaskDescription)

			// 获取当前所有标签页
			chrome.tabs.query({}, (tabs) => {
				// 筛选出已初始化的标签页
				const initializedTabIds = tabs.map((tab) => tab.id).filter((tabId) => isTabInitialized(tabId))

				// 保留初始化标签页数量日志
				console.log(`[BG] 找到 ${initializedTabIds.length} 个已初始化标签页，准备发送录制命令`)

				// 通知已初始化的标签页开始录制
				for (const tabId of initializedTabIds) {
					chrome.tabs.sendMessage(tabId, { command: "START_RECORDING" }).catch((error) => {
						console.warn(`[BG] 通知标签页 ${tabId} 开始录制失败:`, error)

						// 尝试重新初始化
						setTimeout(() => {
							ensureVisualizationInitialized(tabId).then((success) => {
								if (success && isRecording) {
									chrome.tabs
										.sendMessage(tabId, { command: "START_RECORDING" })
										.catch((retryError) => console.error(`[BG] 重试通知失败:`, retryError))
								}
							})
						}, 1000)
					})
				}
			})

			// 添加一个额外检查，确认录制确实已开始
			setTimeout(() => {
				console.log(`[BG] 录制状态检查: isRecording=${isRecording}, recordSession存在=${recordSession !== null}`)
			}, 500)

			sendResponse({
				status: "success",
				message: "录制已开始",
				sessionInfo: {
					sessionId: session.id,
					title: session.title,
				},
			})
			return true
		} else if (message.command === "stopRecording") {
			// 简化的停止录制逻辑
			console.log("[BG] 收到停止录制命令")

			// 再次检查录制状态及是否存在任何不一致
			console.log(`[BG] 停止录制前状态检查: isRecording=${isRecording}, recordSession存在=${recordSession !== null}`)

			// 增强的状态检查：即使状态不完全一致，也尝试恢复和清理
			if (!isRecordingActive()) {
				console.warn("[BG] 录制状态不一致，尝试强制恢复和清理")

				// 检查是否至少有一个状态指示录制正在进行
				if (isRecording || recordSession !== null) {
					// 尝试收集任何可能的会话数据
					let recoveredSessionData = null

					if (recordSession !== null && typeof recordSession === "object") {
						try {
							console.log(`[BG] 尝试从不一致状态恢复会话数据`)
							recoveredSessionData = JSON.parse(JSON.stringify(recordSession))
							console.log(`[BG] 恢复成功，包含${recoveredSessionData.actions?.length || 0}个操作`)
						} catch (error) {
							console.error("[BG] 恢复会话数据失败:", error)
						}
					}

					// 强制清理所有录制相关资源
					cleanupRecordingResources()

					// 发送恢复响应
					sendResponse({
						status: "warning",
						message: "录制状态不一致，已强制停止并清理资源",
						session: recoveredSessionData,
					})

					// 发送会话数据到服务器(如果有)
					if (recoveredSessionData) {
						sendMessageToServer({
							status: "warning",
							message: "录制状态不一致，已强制停止",
							session: recoveredSessionData,
							source: "chromeExtension",
						})
					}

					return true
				}

				// 如果没有任何录制状态，返回错误
				console.warn("[BG] 录制未开始或状态不一致，无法停止")
				sendResponse({
					status: "error",
					message: "无法停止录制：没有正在进行的录制会话",
				})
				return true
			}

			// 保存会话数据
			let sessionData = null
			try {
				// 复制录制会话数据
				console.log(`[BG] 正在复制录制会话数据，ID=${recordSession.id}`)
				sessionData = JSON.parse(JSON.stringify(recordSession))
				console.log(`[BG] 复制完成，包含${sessionData.actions.length}个操作`)
			} catch (error) {
				console.error("[BG] 复制录制会话数据失败:", error)
				sendResponse({
					status: "error",
					message: `保存录制数据失败: ${error.message}`,
				})
				return true
			}

			// 先通知所有标签页停止录制
			console.log("[BG] 正在通知所有标签页停止录制")
			try {
				chrome.tabs.query({}, (tabs) => {
					const initializedTabIds = tabs.map((tab) => tab.id).filter((tabId) => isTabInitialized(tabId))

					console.log(`[BG] 通知${initializedTabIds.length}个标签页停止录制`)
					for (const tabId of initializedTabIds) {
						chrome.tabs
							.sendMessage(tabId, { command: "STOP_RECORDING" })
							.catch((error) => console.warn(`[BG] 通知标签页${tabId}停止录制失败:`, error))
					}
				})
			} catch (error) {
				console.warn("[BG] 通知标签页时出错，继续处理:", error)
			}

			// 清理会话状态
			console.log("[BG] 清理录制会话状态")
			isRecording = false

			// 发送成功响应
			console.log("[BG] 发送停止录制成功响应")
			sendResponse({
				status: "success",
				message: `录制已停止，共记录 ${sessionData.actions.length} 个操作`,
				session: sessionData,
			})

			// 最后再完全清理资源
			setTimeout(() => {
				console.log("[BG] 延迟执行完全资源清理")
				recordSession = null
				pendingActions = []
				lastScreenshot = null
				currentRecordingSessionTitle = ""
				currentRecordingTaskDescription = ""
				lastActionTimestamps.clear()
			}, 100)

			return true
		}
	} catch (error) {
		console.error("[BG] 处理录制命令异常:", error)
		sendResponse({
			status: "error",
			message: `处理录制命令异常: ${error.message}`,
		})
		return true
	}

	return false
}

// 启动扩展
initializeExtension()
