import { sendMessageToServer, recordCommandStep } from "./websocketService.js"
import { captureVisibleTabState } from "./screenshotService.js"
import { applyViewportConfig } from "./viewportService.js"
import { debugTarget, attachDebugger } from "./debuggerService.js"
import { captureVisibleTabPromise } from "./screenshotService.js"
import { waitTillHTMLStable } from "../utils/domUtils.js"

// 存储请求ID到标签页ID的映射
export const tabRequestMap = {}

// 存储由扩展打开的所有标签页ID
export const openedTabIds = new Set()

// 存储等待导航完成的动作
export const pendingNavigationMap = new Map()

// 存储标签页处理状态 - 新增
export const tabProcessingStates = new Map()

// 新增：存储已附加调试器和应用视口的标签页
export const debuggedTabs = new Map()

// 存储已经开始处理的请求ID集合
export const processingRequestIds = new Set()

// 存储当前活动的标签页ID，只能是由扩展打开的标签页
export let activeTabId = null

// 新增：用于标签页事件的监听器
const tabEventListeners = {
	tabActivated: [], // 标签页激活的监听器
	tabClosed: [], // 标签页关闭的监听器
}

// 全局变量，跟踪我们是否正在等待新标签页打开
export let waitingForNewTab = false
// 全局变量，存储最近激活的标签页信息
export let lastActivatedTabInfo = null

/**
 * 获取当前活动的标签页ID
 * @returns {number|null} 标签页ID或null
 */
export function getActiveTabId() {
	// 简单返回当前记录的活动标签页ID
	// 只有在openedTabIds中的标签页才能成为activeTabId
	if (activeTabId && openedTabIds.has(activeTabId)) {
		return activeTabId
	}
	return null
}

/**
 * 设置当前活动的标签页ID
 * @param {number} tabId - 标签页ID
 */
export function setActiveTabId(tabId) {
	// 只有由扩展打开的标签页才能设为活动标签页
	if (tabId && openedTabIds.has(tabId)) {
		activeTabId = tabId
		console.log(`[BG_WS_TABS] 设置活动标签页ID为 ${tabId}`)
	}
}

/**
 * 添加标签页事件监听器
 * @param {string} eventType - 事件类型: 'tabActivated', 'tabClosed'
 * @param {Function} listener - 监听函数
 */
export function addTabEventListener(eventType, listener) {
	if (tabEventListeners[eventType]) {
		tabEventListeners[eventType].push(listener)
		console.log(`[BG_WS_TABS] 添加了${eventType}事件监听器`)
	}
}

/**
 * 移除标签页事件监听器
 * @param {string} eventType - 事件类型
 * @param {Function} listener - 监听函数
 */
export function removeTabEventListener(eventType, listener) {
	if (tabEventListeners[eventType] && listener) {
		const index = tabEventListeners[eventType].indexOf(listener)
		if (index !== -1) {
			tabEventListeners[eventType].splice(index, 1)
			console.log(`[BG_WS_TABS] 移除了${eventType}事件监听器`)
		}
	}
}

/**
 * 触发标签页事件
 * @param {string} eventType - 事件类型
 * @param {Object} eventData - 事件数据
 */
function triggerTabEvent(eventType, eventData) {
	if (tabEventListeners[eventType] && tabEventListeners[eventType].length > 0) {
		console.log(`[BG_WS_TABS] 触发${eventType}事件，有${tabEventListeners[eventType].length}个监听器`)
		tabEventListeners[eventType].forEach((listener) => {
			try {
				listener(eventData)
			} catch (error) {
				console.error(`[BG_WS_TABS] 执行${eventType}事件监听器出错:`, error)
			}
		})
	}
}

/**
 * 标签页处理状态常量
 */
export const TabProcessingState = {
	IDLE: "idle", // 空闲
	NAVIGATION_PENDING: "nav_pending", // 等待导航
	STABILIZING: "stabilizing", // 稳定化中
	ATTACHING: "attaching", // 附加调试器中
	CAPTURING: "capturing", // 捕获截图中
	COMPLETED: "completed", // 已完成处理
}

/**
 * 初始化标签页相关的事件监听器
 */
export function initTabListeners() {
	// 监听标签页更新事件
	chrome.tabs.onUpdated.addListener(handleTabUpdated)

	// 监听标签页关闭事件
	chrome.tabs.onRemoved.addListener(handleTabRemoved)

	// 监听标签页激活事件
	chrome.tabs.onActivated.addListener((info) => {
		console.log(`[BG_WS_TABS] 标签页激活: tabId=${info.tabId}, windowId=${info.windowId}`)

		// 保存最近激活的标签页信息，用于判断新标签页
		lastActivatedTabInfo = {
			tabId: info.tabId,
			windowId: info.windowId,
			timestamp: Date.now(),
		}

		// 如果我们正在等待新标签页打开，立即将此标签页添加到跟踪集合
		if (waitingForNewTab && !openedTabIds.has(info.tabId)) {
			console.log(`[BG_WS_TABS] 检测到等待中的新标签页激活: ${info.tabId}，立即添加到跟踪列表`)
			openedTabIds.add(info.tabId)
			setActiveTabId(info.tabId)
		}
		// 即使不是在等待新标签页，只要是由我们跟踪的标签页打开的，也要设置为activeTabId
		else if (openedTabIds.has(info.tabId)) {
			setActiveTabId(info.tabId)
		}

		triggerTabEvent("tabActivated", {
			tabId: info.tabId,
			windowId: info.windowId,
			previousTabId: info.previousTabId,
		})
	})
}

/**
 * 处理标签页更新事件
 * @param {number} tabId - 标签页ID
 * @param {Object} changeInfo - 变更信息
 * @param {chrome.tabs.Tab} tab - 标签页对象
 */
async function handleTabUpdated(tabId, changeInfo, tab) {
	// 避免处理非跟踪的标签页或无关事件
	if (!openedTabIds.has(tabId) && !tab.openerTabId) {
		return
	}

	// 确保跟踪由已跟踪标签页打开的新标签页
	if (tab.openerTabId && openedTabIds.has(tab.openerTabId) && !openedTabIds.has(tabId)) {
		console.log(`[BG_WS] Detected new tab ${tabId} opened from tracked tab ${tab.openerTabId}, adding to tracked tabs.`)
		openedTabIds.add(tabId)
		console.log(`[BG_WS] Updated tracked tabs:`, Array.from(openedTabIds))

		// 对新打开的标签页尽早应用viewport配置
		// 附加调试器
		try {
			await attachDebugger(tabId)
			if (debugTarget && debugTarget.tabId === tabId) {
				// 应用视口配置
				await applyViewportConfig(debugTarget)
				console.log(`[BG_WS_TABS] 在新标签页 ${tabId} 初始化时应用viewport配置`)
			}
		} catch (error) {
			console.warn(`[BG_WS_TABS] 无法在新标签页 ${tabId} 初始化时应用viewport:`, error)
		}
	}

	// 处理等待导航的动作 (来自 click, pressKey 等)
	if (changeInfo.status === "complete" && pendingNavigationMap.has(tabId)) {
		const pendingAction = pendingNavigationMap.get(tabId)
		const requestId = pendingAction.requestId

		// 检查这个请求是否已经在处理中，避免重复处理
		if (processingRequestIds.has(requestId)) {
			console.log(`[BG_WS] Request ${requestId} is already being processed, skipping duplicate handling.`)
			return
		}

		// 标记这个请求为处理中
		processingRequestIds.add(requestId)

		console.log(`[BG_WS] Tab ${tabId} completed, resolving pending action ${pendingAction.command} (${requestId}).`)

		clearTimeout(pendingAction.timerId) // 清除超时定时器

		// 立即从Map中移除，防止重复处理
		pendingNavigationMap.delete(tabId)

		try {
			// 使用核心处理函数处理导航完成的标签页
			const result = await processTabCore({
				tabId,
				operationType: pendingAction.command,
				requestId,
				isBatchMode: false,
				isNewTab: true,
				preProcessing: async () => {
					// 更新活动标签页
					setActiveTabId(tabId)
				},
			})

			// 解析等待的Promise
			pendingAction.resolve({
				...result,
				navigationOccurred: true,
			})
		} catch (error) {
			console.error(`[BG_WS] Error processing pending action for ${requestId} after tab complete:`, error)

			// 清理状态
			tabProcessingStates.set(tabId, TabProcessingState.IDLE)
			pendingAction.reject(new Error(`Error capturing state for pending action: ${error.message}`))
		} finally {
			// 无论成功失败都要清理处理中的请求标记
			processingRequestIds.delete(requestId)
		}
	}
}

/**
 * 处理标签页关闭事件
 * @param {number} tabId - 标签页ID
 * @param {Object} removeInfo - 移除信息
 */
function handleTabRemoved(tabId, removeInfo) {
	// 从集合中移除标签页ID
	if (openedTabIds.has(tabId)) {
		openedTabIds.delete(tabId)
		console.log(`[BG_WS] Tracked tab ${tabId} was removed. Updated set:`, Array.from(openedTabIds))

		// 如果关闭的是当前活动标签页，寻找新的活动标签页
		if (activeTabId === tabId) {
			activeTabId = null
			console.log(`[BG_WS_TABS] 标签页${tabId}已关闭，需要选择新的活动标签页`)

			// 尝试激活剩下的标签页中的一个
			if (openedTabIds.size > 0) {
				const newActiveTabId = Array.from(openedTabIds)[0]
				// 立即激活新的标签页
				chrome.tabs
					.update(newActiveTabId, { active: true })
					.then(() => {
						console.log(`[BG_WS_TABS] 自动激活新的标签页: ${newActiveTabId}`)
						setActiveTabId(newActiveTabId)
					})
					.catch((err) => {
						console.error(`[BG_WS_TABS] 无法激活新的标签页:`, err)
					})
			}
		}

		// 触发tabClosed事件
		triggerTabEvent("tabClosed", { tabId, removeInfo })
	}

	// 清理请求映射
	if (tabRequestMap[tabId]) {
		console.log(`[BG_WS] Cleaning up request map for removed tab ${tabId} (request: ${tabRequestMap[tabId]})`)
		delete tabRequestMap[tabId]
	}

	// 清理处理状态
	if (tabProcessingStates.has(tabId)) {
		console.log(`[BG_WS_TABS] Cleaning up processing state for tab ${tabId}: ${tabProcessingStates.get(tabId)}`)
		tabProcessingStates.delete(tabId)
	}

	// 清理debugTarget，如果当前附加到此标签
	if (debugTarget && debugTarget.tabId === tabId) {
		console.log(`[BG_WS] Cleaning debugger target for closed tab ${tabId}`)
		// 不要直接设置为null，可能会导致其他问题
		// 留给下一次attachDebugger调用来设置
	}

	// 清理pendingNavigationMap
	if (pendingNavigationMap.has(tabId)) {
		const pending = pendingNavigationMap.get(tabId)
		console.log(`[BG_WS] Cleaning up pending navigation for closed tab ${tabId}`)
		if (pending.timerId) {
			clearTimeout(pending.timerId)
		}
		pendingNavigationMap.delete(tabId)
	}
}

/**
 * 检查标签页是否正在处理中
 * @param {number} tabId - 标签页ID
 * @returns {boolean} - 是否正在处理
 */
export function isTabProcessing(tabId) {
	const currentState = tabProcessingStates.get(tabId) || TabProcessingState.IDLE
	return currentState !== TabProcessingState.IDLE && currentState !== TabProcessingState.COMPLETED
}

/**
 * 等待标签页处理完成
 * @param {number} tabId - 标签页ID
 * @param {number} timeout - 超时时间(毫秒)
 * @returns {Promise<void>}
 */
export async function waitForTabProcessingComplete(tabId, timeout = 30000) {
	// 批处理操作特殊处理
	const isBatchOperation = tabProcessingStates.get(tabId) === "batch_processing"
	if (isBatchOperation) {
		console.log(`[BG_WS] Detected batch operation for tab ${tabId}, using faster state resolution`)
		// 批处理操作直接解析，不进行状态检查
		return Promise.resolve()
	}

	if (!tabProcessingStates.has(tabId) || tabProcessingStates.get(tabId) === TabProcessingState.COMPLETED) {
		return
	}

	return new Promise((resolve, reject) => {
		const startTime = Date.now()

		const checkState = () => {
			// 检查tab是否存在
			chrome.tabs.get(tabId).catch(() => {
				console.log(`[BG_WS] Tab ${tabId} no longer exists, resolving state check`)
				resolve()
				return
			})

			if (
				!tabProcessingStates.has(tabId) ||
				tabProcessingStates.get(tabId) === TabProcessingState.COMPLETED ||
				tabProcessingStates.get(tabId) === TabProcessingState.IDLE
			) {
				resolve()
				return
			}

			const elapsedTime = Date.now() - startTime
			if (elapsedTime > timeout) {
				console.warn(
					`[BG_WS] Timeout waiting for tab ${tabId} processing to complete after ${elapsedTime}ms. Current state: ${tabProcessingStates.get(tabId)}`,
				)
				// 超时后自动重置状态而不是拒绝Promise
				tabProcessingStates.set(tabId, TabProcessingState.IDLE)
				resolve() // 改为resolve不影响后续操作
				return
			}

			// 增大状态检查间隔
			setTimeout(checkState, 500)
		}

		checkState()
	})
}

/**
 * 处理导航请求
 * @param {string} url - 目标URL
 * @param {string} requestId - 请求ID
 * @param {string} commandName - 命令名称
 * @param {Object} messageData - 完整的消息数据
 */
export async function handleNavigate(url, requestId, commandName, messageData = {}) {
	console.log(`[BG_WS] Navigating to: ${url} (request: ${requestId}, command: ${commandName})`)
	const startTime = performance.now()
	recordCommandStep(requestId, "开始处理导航")

	try {
		// 如果指定了tabId，尝试使用已有标签页
		let existingTab = null
		if (messageData?.tabId) {
			try {
				existingTab = await chrome.tabs.get(messageData.tabId)
				console.log(`[BG_WS] Found existing tab ${existingTab.id} to update`)
			} catch (e) {
				console.log(`[BG_WS] Tab ID ${messageData.tabId} not found`)
			}
		}

		let tab
		// 如果找到现有标签页，更新它
		if (existingTab) {
			// 设置处理状态
			tabProcessingStates.set(existingTab.id, TabProcessingState.NAVIGATION_PENDING)
			console.log(`[BG_WS] Tab ${existingTab.id} state updated to: ${TabProcessingState.NAVIGATION_PENDING}`)

			tab = await chrome.tabs.update(existingTab.id, { url, active: true })
			recordCommandStep(requestId, "更新现有标签页")
		} else {
			// 否则创建新标签页
			tab = await chrome.tabs.create({ url, active: true })
			recordCommandStep(requestId, "创建新标签页")

			// 设置处理状态
			tabProcessingStates.set(tab.id, TabProcessingState.NAVIGATION_PENDING)
			console.log(`[BG_WS] Tab ${tab.id} state updated to: ${TabProcessingState.NAVIGATION_PENDING}`)
		}

		// 添加到已打开标签页集合
		openedTabIds.add(tab.id)
		console.log(`[BG_WS] Tracking opened tab IDs:`, Array.from(openedTabIds))

		// 更新活动标签页
		setActiveTabId(tab.id)

		// 存储标签页ID到请求ID的映射
		if (requestId && tab.id) {
			tabRequestMap[tab.id] = requestId
			console.log(`[BG_WS] Stored mapping: Tab ${tab.id} -> Request ${requestId}`)
		}

		// 使用核心处理函数
		const result = await processTabCore({
			tabId: tab.id,
			operationType: commandName,
			requestId,
			isBatchMode: false,
			isNewTab: true,
			postProcessing: async () => {
				// 清理请求映射
				if (tabRequestMap[tab.id]) {
					delete tabRequestMap[tab.id]
					console.log(`[BG_WS] 导航完成，已移除标签页 ${tab.id} 与请求 ${requestId} 的映射`)
				}
			},
		})

		// 直接发送响应，不依赖事件处理
		sendMessageToServer({
			...result,
			tabId: tab.id,
		})

		const endTime = performance.now()
		const totalTime = endTime - startTime
		console.log(`[BG_WS] handleNavigate 函数总耗时: ${totalTime.toFixed(2)}ms`)
	} catch (error) {
		console.error(`[BG_WS] Error navigating to ${url}:`, error)
		sendMessageToServer({
			status: "error",
			command: commandName,
			url: url,
			message: error.message || String(error),
			requestId: requestId,
		})
	}
}

/**
 * 执行操作并处理标签页状态变化的通用函数
 * @param {string} operationType - 操作类型（如"click"、"pressKey"等）
 * @param {string} requestId - 请求ID
 * @param {Function} operationFn - 执行的操作函数，不需要传activeTabId
 * @param {boolean} isBatchMode - 是否为批处理模式，在此模式下跳过截图
 * @returns {Promise<Object>} - 操作结果，包含截图、URL等信息
 */
export async function waitForTabOperationComplete(operationType, requestId, operationFn, isBatchMode = false) {
	// 获取当前活动标签页ID
	const initialActiveTabId = getActiveTabId()
	if (!initialActiveTabId) {
		throw new Error(`无可用的标签页执行${operationType}操作`)
	}

	console.log(`[BG_WS_TABS] 开始执行${operationType}操作 (request: ${requestId}, batchMode: ${isBatchMode})`)

	// 检查标签页是否正在处理中，如果是，则等待完成
	if (isTabProcessing(initialActiveTabId)) {
		console.log(`[BG_WS_TABS] 标签页 ${initialActiveTabId} 当前正在处理中。等待完成后继续操作。`)
		await waitForTabProcessingComplete(initialActiveTabId, 10000) // 等待最多10秒
		console.log(`[BG_WS_TABS] 标签页 ${initialActiveTabId} 处理完成，现在继续${operationType}操作。`)
	}

	// 记录操作前的标签页状态
	const tabsBeforeOperation = Array.from(openedTabIds)

	return new Promise(async (resolve, reject) => {
		// 新标签页检测状态
		let newTabDetected = false
		let navigationHandled = false

		// 快速检测计时器
		let fastDetectionTimer = null
		// 长等待计时器（仅在检测到新标签页时使用）
		let longWaitTimer = null

		// 创建标签页激活事件处理函数
		const tabActivatedHandler = (event) => {
			if (navigationHandled) return // 避免重复处理

			// 检查是否是新标签页
			if (!tabsBeforeOperation.includes(event.tabId)) {
				console.log(`[BG_WS_TABS] 检测到新标签页激活: ${event.tabId}`)

				// 立即标记检测到新标签页
				newTabDetected = true

				// 立即清除快速检测计时器
				if (fastDetectionTimer) {
					clearTimeout(fastDetectionTimer)
					fastDetectionTimer = null
				}

				// 将新标签页添加到跟踪列表并设为活动标签页
				if (!openedTabIds.has(event.tabId)) {
					openedTabIds.add(event.tabId)
					setActiveTabId(event.tabId)
				}

				// 确认是否由目标标签页打开
				chrome.tabs
					.get(event.tabId)
					.then((tab) => {
						if ((tab.openerTabId === initialActiveTabId || !tab.openerTabId) && !navigationHandled) {
							// 处理新标签页
							navigationHandled = true

							// 移除事件监听器
							removeTabEventListener("tabActivated", tabActivatedHandler)

							// 取消所有计时器
							if (longWaitTimer) {
								clearTimeout(longWaitTimer)
								longWaitTimer = null
							}

							// 使用核心处理函数处理新标签页
							processNewTab(event.tabId, initialActiveTabId, operationType, requestId, resolve, reject, isBatchMode)
						}
					})
					.catch((err) => {
						console.error(`[BG_WS_TABS] 获取标签页信息失败:`, err)
					})
			}
		}

		try {
			// 设置处理状态为导航等待
			tabProcessingStates.set(initialActiveTabId, TabProcessingState.NAVIGATION_PENDING)
			console.log(`[BG_WS_TABS] 标签页 ${initialActiveTabId} 状态更新为: ${TabProcessingState.NAVIGATION_PENDING}`)

			// 添加标签页激活事件监听器
			addTabEventListener("tabActivated", tabActivatedHandler)

			// 执行操作
			await operationFn()
			console.log(`[BG_WS_TABS] 已向标签页 ${initialActiveTabId} 发送${operationType}事件。`)

			// 设置快速检测计时器 - 500ms后检查是否有新标签页
			fastDetectionTimer = setTimeout(async () => {
				if (newTabDetected) {
					// 已检测到新标签页，继续等待长计时器
					console.log(`[BG_WS_TABS] 已检测到新标签页，等待完成加载...`)
					return
				}

				console.log(`[BG_WS_TABS] 快速检测结束: ${operationType}未创建新标签页，在原页面继续处理`)

				// 移除事件监听器
				removeTabEventListener("tabActivated", tabActivatedHandler)

				// 处理原始标签页
				if (!navigationHandled) {
					navigationHandled = true

					// 清除长等待计时器
					if (longWaitTimer) {
						clearTimeout(longWaitTimer)
						longWaitTimer = null
					}

					// 使用核心处理函数处理当前标签页
					processActiveTab(initialActiveTabId, operationType, requestId, resolve, reject, isBatchMode)
				}
			}, 500)

			// 设置长等待计时器 - 如果5秒后仍未完成处理，确保操作完成
			longWaitTimer = setTimeout(() => {
				if (navigationHandled) return

				console.log(`[BG_WS_TABS] 长时间等待超时：${operationType}操作处理超时`)

				// 移除事件监听器
				removeTabEventListener("tabActivated", tabActivatedHandler)

				// 清除快速检测计时器（如果仍存在）
				if (fastDetectionTimer) {
					clearTimeout(fastDetectionTimer)
					fastDetectionTimer = null
				}

				// 确定最终使用哪个标签页
				const finalTabId = newTabDetected ? getActiveTabId() : initialActiveTabId

				// 处理标签页
				navigationHandled = true
				processActiveTab(finalTabId, operationType, requestId, resolve, reject, isBatchMode)
			}, 5000)
		} catch (operationError) {
			// 操作本身出错
			console.error(`[BG_WS_TABS] 执行${operationType}操作 ${requestId} 时出错:`, operationError)

			// 清理资源
			removeTabEventListener("tabActivated", tabActivatedHandler)

			if (fastDetectionTimer) {
				clearTimeout(fastDetectionTimer)
			}

			if (longWaitTimer) {
				clearTimeout(longWaitTimer)
			}

			// 重置状态
			tabProcessingStates.set(initialActiveTabId, TabProcessingState.IDLE)
			reject(operationError)
		}
	})
}

/**
 * 处理新标签页的辅助函数
 * @param {number} newTabId - 新标签页ID
 * @param {number} originalTabId - 原始标签页ID
 * @param {string} operationType - 操作类型
 * @param {string} requestId - 请求ID
 * @param {Function} resolve - Promise的resolve函数
 * @param {Function} reject - Promise的reject函数
 * @param {boolean} isBatchMode - 是否为批处理模式，在此模式下跳过截图
 */
async function processNewTab(newTabId, originalTabId, operationType, requestId, resolve, reject, isBatchMode = false) {
	try {
		// 使用核心处理函数
		const result = await processTabCore({
			tabId: newTabId,
			operationType,
			requestId,
			isBatchMode,
			isNewTab: true,
			originalTabId,
		})

		// 返回成功结果
		resolve(result)
	} catch (error) {
		console.error(`[BG_WS_TABS] 处理新标签页出错:`, error)
		tabProcessingStates.set(newTabId, TabProcessingState.IDLE)
		reject(error)
	}
}

/**
 * 处理活动标签页的辅助函数（没有新标签页打开的情况）
 * @param {number} tabId - 标签页ID
 * @param {string} operationType - 操作类型
 * @param {string} requestId - 请求ID
 * @param {Function} resolve - Promise的resolve函数
 * @param {Function} reject - Promise的reject函数
 * @param {boolean} isBatchMode - 是否为批处理模式，在此模式下跳过截图
 */
async function processActiveTab(tabId, operationType, requestId, resolve, reject, isBatchMode = false) {
	try {
		// 使用核心处理函数
		const result = await processTabCore({
			tabId,
			operationType,
			requestId,
			isBatchMode,
			isNewTab: false,
		})

		// 返回成功结果
		resolve(result)
	} catch (error) {
		console.error(`[BG_WS_TABS] 处理标签页出错:`, error)
		tabProcessingStates.set(tabId, TabProcessingState.IDLE)
		reject(error)
	}
}

/**
 * 获取当前活动标签页的截图
 * @param {string} requestId - 请求ID
 * @returns {Promise<{screenshot: string, currentUrl: string}>} - 截图和URL信息
 */
export async function captureCurrentTabState(requestId) {
	const activeTabId = getActiveTabId()
	if (!activeTabId) {
		throw new Error("无可用的活动标签页")
	}

	try {
		// 获取当前URL
		const tab = await chrome.tabs.get(activeTabId)

		// 捕获当前标签页截图
		const screenshotDataUrl = await captureVisibleTabPromise(activeTabId)

		return {
			screenshot: screenshotDataUrl,
			currentUrl: tab.url,
			tabId: activeTabId,
		}
	} catch (error) {
		console.error(`[BG_WS_TABS] 捕获标签页状态出错 (request: ${requestId}):`, error)
		throw error
	}
}

/**
 * 执行简单操作并获取当前标签页状态（用于不触发导航的操作如type）
 * @param {string} operationType - 操作类型（如"type"）
 * @param {string} requestId - 请求ID
 * @param {Function} operationFn - 执行的操作函数
 * @param {boolean} isBatchMode - 是否为批处理模式，在此模式下跳过截图
 * @returns {Promise<Object>} - 操作结果
 */
export async function performSimpleOperation(operationType, requestId, operationFn, isBatchMode = false) {
	// 获取当前活动标签页ID
	const activeTabId = getActiveTabId()
	if (!activeTabId) {
		throw new Error(`无可用的标签页执行${operationType}操作`)
	}

	console.log(`[BG_WS_TABS] 开始执行${operationType}操作 (request: ${requestId}, batchMode: ${isBatchMode})`)
	recordCommandStep(requestId, `开始执行${operationType}操作`)

	// 检查标签页是否正在处理中
	if (isTabProcessing(activeTabId)) {
		console.log(`[BG_WS_TABS] 标签页 ${activeTabId} 当前正在处理中。等待完成后继续操作。`)
		await waitForTabProcessingComplete(activeTabId, 10000)
		console.log(`[BG_WS_TABS] 标签页 ${activeTabId} 处理完成，现在继续${operationType}操作。`)
	}

	try {
		// 简单操作的前置处理（执行操作）
		await operationFn()
		console.log(`[BG_WS_TABS] 已完成${operationType}操作`)
		recordCommandStep(requestId, `完成${operationType}操作`)

		// 简单的等待，不需要完整的稳定检查
		// 对于大多数简单操作，等待很短的时间即可
		const waitTime = operationType === "wait" ? 0 : 300 // wait命令自己已经等待过了
		if (waitTime > 0) {
			await new Promise((resolve) => setTimeout(resolve, waitTime))
		}

		// 使用核心处理函数，但跳过部分步骤
		const result = await processTabCore({
			tabId: activeTabId,
			operationType,
			requestId,
			isBatchMode,
			isNewTab: false,
			// 简单操作已经执行过，无需重复等待DOM
			preProcessing: () => {
				// 直接设置状态为稳定化，跳过导航等待
				tabProcessingStates.set(activeTabId, TabProcessingState.STABILIZING)
			},
		})

		// 简单操作返回"ack"状态而不是"success"
		return {
			...result,
			status: "ack",
		}
	} catch (error) {
		console.error(`[BG_WS_TABS] 执行${operationType}操作 ${requestId} 时出错:`, error)
		// 重置处理状态
		tabProcessingStates.set(activeTabId, TabProcessingState.IDLE)
		throw error
	}
}

/**
 * 关闭所有由扩展打开的标签页
 * @param {string} requestId - 请求ID
 * @returns {Promise<Object>} - 关闭操作的结果
 */
export async function closeAllTabs(requestId) {
	console.log(`[BG_WS_TABS] 收到关闭所有标签页请求 (request: ${requestId})`)

	// 获取要关闭的标签页快照并清除集合
	const tabIdsToClose = Array.from(openedTabIds)
	openedTabIds.clear() // 假设我们已完成这些标签页

	if (tabIdsToClose.length === 0) {
		console.warn(`[BG_WS_TABS] 收到关闭命令，但扩展没有跟踪任何标签页。`)
		// 即使没有打开的标签页也捕获当前屏幕
		const screenshotDataUrl = await captureVisibleTabPromise(null) // 传递null用于活动标签页
		return {
			status: "ack",
			command: "close",
			requestId: requestId,
			screenshot: screenshotDataUrl,
		}
	}

	console.log(`[BG_WS_TABS] 尝试关闭标签页:`, tabIdsToClose)

	// 关闭所有标签页
	const closeResults = await Promise.allSettled(tabIdsToClose.map((tabId) => chrome.tabs.remove(tabId)))

	let closedCount = 0
	let failedCount = 0

	closeResults.forEach((result, index) => {
		const tabId = tabIdsToClose[index]
		if (result.status === "fulfilled") {
			closedCount++
			// 清理成功关闭的标签页的请求映射条目
			if (tabRequestMap[tabId]) {
				delete tabRequestMap[tabId]
			}
		} else {
			failedCount++
			console.warn(`[BG_WS_TABS] 关闭标签页 ${tabId} 失败: ${result.reason?.message}`)
			// 即使关闭失败也清理映射条目（它可能无效）
			if (tabRequestMap[tabId]) {
				delete tabRequestMap[tabId]
			}
		}
	})

	console.log(`[BG_WS_TABS] 关闭操作完成。已关闭: ${closedCount}, 失败/已关闭: ${failedCount}`)

	// 关闭标签页后捕获当前窗口的截图
	const screenshotDataUrl = await captureVisibleTabPromise(null) // 传递null用于当前窗口的活动标签页

	return {
		status: "ack",
		command: "close",
		requestId: requestId,
		screenshot: screenshotDataUrl,
	}
}

/**
 * 获取标签页列表
 * @param {string} requestId - 请求ID
 * @returns {Promise<Object>} - 标签页列表和相关信息
 */
export async function getTabList(requestId) {
	console.log(`[BG_WS_TABS] 收到获取标签页列表请求 (request: ${requestId})`)

	try {
		// 获取所有标签页
		const tabs = await chrome.tabs.query({})

		// 严格过滤标签页，只保留由我们管理且可见的标签页
		const filteredTabs = tabs.filter((tab) => {
			// 排除扩展页面、设置页面和空白页
			const isHidden =
				tab.url.startsWith("chrome-extension://") || tab.url.startsWith("chrome://") || tab.url === "about:blank"

			// 必须是我们跟踪的标签页
			const isTracking = openedTabIds.has(tab.id)

			// 不是隐藏页面 且 是我们跟踪的标签页
			return !isHidden && isTracking
		})

		console.log(`[BG_WS_TABS] 从 ${tabs.length} 个标签页过滤出 ${filteredTabs.length} 个有效标签页`)
		console.log(`[BG_WS_TABS] 当前跟踪的标签页:`, Array.from(openedTabIds))

		// 格式化标签页信息
		const formattedTabs = filteredTabs.map((tab, index) => ({
			id: tab.id,
			index,
			title: tab.title,
			url: tab.url,
			active: tab.active,
			isTrackingTab: true, // 既然已经过滤了，这里就总是true
		}))

		// 获取当前活动标签页
		const activeTabId = getActiveTabId()

		// 捕获当前活动标签页的截图
		let screenshotDataUrl = null
		if (activeTabId) {
			screenshotDataUrl = await captureVisibleTabPromise(activeTabId)
			console.log(`[BG_WS_TABS] 从标签页 ${activeTabId} 捕获截图，数据长度: ${screenshotDataUrl?.length || 0}`)
		}

		return {
			status: "success",
			command: "listTabs",
			requestId: requestId,
			tabs: formattedTabs,
			currentTabId: activeTabId,
			screenshot: screenshotDataUrl,
		}
	} catch (error) {
		console.error(`[BG_WS_TABS] 获取标签页列表出错:`, error)
		throw error
	}
}

/**
 * 创建新标签页
 * @param {string} requestId - 请求ID
 * @param {string} url - 要加载的URL
 * @returns {Promise<Object>} - 新标签页的信息和截图
 */
export async function createNewTab(requestId, url) {
	const startTime = performance.now()
	const urlToLoad = url || "https://bing.com"
	console.log(`[BG_WS_TABS] 收到创建新标签页请求 (request: ${requestId}, url: ${urlToLoad})`)
	recordCommandStep(requestId, "开始createNewTab")

	try {
		// 创建标签页
		const tabCreateStart = performance.now()
		const tab = await chrome.tabs.create({ url: urlToLoad, active: true })
		const tabCreateEnd = performance.now()
		console.log(
			`[BG_WS_TABS] 已创建标签页 ${tab.id}，加载URL: ${urlToLoad}，耗时: ${(tabCreateEnd - tabCreateStart).toFixed(2)}ms`,
		)
		recordCommandStep(requestId, "标签页创建完成")

		// 添加到已打开标签页集合
		openedTabIds.add(tab.id)

		// 使用核心处理函数来处理新创建的标签页
		const result = await processTabCore({
			tabId: tab.id,
			operationType: "newTab",
			requestId,
			isBatchMode: false,
			isNewTab: true,
			preProcessing: () => {
				// 设置活动标签页
				setActiveTabId(tab.id)
			},
		})

		return {
			...result,
			message: `标签页创建成功: ${urlToLoad}`,
		}
	} catch (error) {
		console.error(`[BG_WS_TABS] 创建标签页出错:`, error)
		throw error
	}
}

/**
 * 选择并激活标签页
 * @param {string} requestId - 请求ID
 * @param {number} index - 标签页索引
 * @returns {Promise<Object>} - 激活的标签页信息和截图
 */
export async function selectTab(requestId, index) {
	console.log(`[BG_WS_TABS] 收到选择标签页请求 (request: ${requestId}, index: ${index})`)
	recordCommandStep(requestId, "开始处理selectTab命令")
	const startTime = performance.now()

	try {
		// 获取所有标签页
		const tabs = await chrome.tabs.query({})

		// 过滤标签页 - 使用与listTabs命令相同的逻辑
		const filteredTabs = tabs.filter((tab) => {
			// 排除扩展页面、设置页面和空白页
			const isHidden =
				tab.url.startsWith("chrome-extension://") || tab.url.startsWith("chrome://") || tab.url === "about:blank"

			// 只保留我们跟踪的标签页和活动标签页
			const isTracking = openedTabIds.has(tab.id)
			const isActive = tab.active

			return !isHidden && (isTracking || isActive)
		})

		// 检查索引是否有效
		if (index < 0 || index >= filteredTabs.length) {
			throw new Error(`无效的标签页索引: ${index}. 有效范围: 0-${filteredTabs.length - 1}`)
		}

		const targetTab = filteredTabs[index]
		console.log(`[BG_WS_TABS] 选择索引为 ${index} 的标签页: 标签页 ${targetTab.id} (${targetTab.url})`)
		recordCommandStep(requestId, `找到目标标签页: ${targetTab.id}`)

		// 激活指定标签页
		await chrome.tabs.update(targetTab.id, { active: true })
		recordCommandStep(requestId, "标签页激活完成")

		// 使用核心处理函数
		const result = await processTabCore({
			tabId: targetTab.id,
			operationType: "selectTab",
			requestId,
			isBatchMode: false,
			isNewTab: false,
			preProcessing: async () => {
				// 确保该标签页被跟踪
				if (!openedTabIds.has(targetTab.id)) {
					openedTabIds.add(targetTab.id)
					console.log(`[BG_WS_TABS] 将标签页 ${targetTab.id} 添加到跟踪标签页集合`)
				}

				// 设置为活动标签页
				setActiveTabId(targetTab.id)
			},
		})

		return {
			...result,
			message: `已切换到索引为 ${index} 的标签页: ${targetTab.url}`,
		}
	} catch (error) {
		console.error(`[BG_WS_TABS] 选择标签页出错:`, error)
		throw error
	}
}

/**
 * 关闭指定索引的标签页
 * @param {string} requestId - 请求ID
 * @param {number} index - 要关闭的标签页索引，可选
 * @returns {Promise<Object>} - 关闭操作的结果
 */
export async function closeTabByIndex(requestId, index) {
	console.log(`[BG_WS_TABS] 收到关闭标签页请求 (request: ${requestId}, index: ${index})`)

	try {
		// 获取标签页信息
		let targetTabId = null
		const allTabs = await chrome.tabs.query({})

		// 过滤有效的标签页
		const filteredTabs = allTabs.filter((tab) => {
			// 排除扩展页面、设置页面和空白页
			const isHidden =
				tab.url.startsWith("chrome-extension://") || tab.url.startsWith("chrome://") || tab.url === "about:blank"

			// 只保留我们跟踪的标签页和活动标签页
			const isTracking = openedTabIds.has(tab.id)
			const isActive = tab.active

			return !isHidden && (isTracking || isActive)
		})

		if (index !== undefined) {
			// 检查索引是否有效
			if (index < 0 || index >= filteredTabs.length) {
				throw new Error(`无效的标签页索引: ${index}. 有效范围: 0-${filteredTabs.length - 1}`)
			}

			targetTabId = filteredTabs[index].id
			console.log(`[BG_WS_TABS] 将关闭索引为 ${index} 的标签页: 标签页 ${targetTabId} (${filteredTabs[index].url})`)
		} else {
			// 如果没有指定索引，关闭当前活动的标签页
			const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true })
			if (activeTabs.length === 0) {
				throw new Error("未找到活动标签页")
			}
			targetTabId = activeTabs[0].id
			console.log(`[BG_WS_TABS] 将关闭当前活动标签页: ${targetTabId} (${activeTabs[0].url})`)
		}

		// 保存除要关闭标签页以外的所有有效标签页
		const validTabsToActivate = filteredTabs
			.filter((tab) => tab.id !== targetTabId)
			.map((tab) => ({ id: tab.id, url: tab.url }))

		console.log(`[BG_WS_TABS] 关闭后可激活的有效标签页: ${JSON.stringify(validTabsToActivate)}`)

		// 关闭标签页
		await chrome.tabs.remove(targetTabId)
		console.log(`[BG_WS_TABS] 成功关闭标签页 ${targetTabId}`)

		// 从跟踪集合中移除
		if (openedTabIds.has(targetTabId)) {
			openedTabIds.delete(targetTabId)
			console.log(`[BG_WS_TABS] 已从跟踪标签页集合中移除标签页 ${targetTabId}`)
		}

		// 清理请求映射
		if (tabRequestMap[targetTabId]) {
			delete tabRequestMap[targetTabId]
		}

		if (validTabsToActivate.length > 0) {
			// 主动选择下一个有效标签页
			const nextTab = validTabsToActivate[0]
			console.log(`[BG_WS_TABS] 主动选择标签页 ${nextTab.id} (${nextTab.url}) 作为下一个活动标签页`)

			// 添加小延迟确保关闭操作完成
			await new Promise((resolve) => setTimeout(resolve, 500))

			// 主动激活选定的标签页
			await chrome.tabs.update(nextTab.id, { active: true })

			// 再次延迟确保激活成功
			await new Promise((resolve) => setTimeout(resolve, 500))

			// 附加调试器
			await attachDebugger(nextTab.id)

			// 应用视口配置
			if (debugTarget && debugTarget.tabId === nextTab.id) {
				await applyViewportConfig(debugTarget)
			}

			// 获取当前标签页信息
			const tab = await chrome.tabs.get(nextTab.id)

			// 设置为活动标签页
			setActiveTabId(nextTab.id)

			// 捕获截图
			const screenshotDataUrl = await captureVisibleTabPromise(nextTab.id)

			return {
				status: "success",
				command: "closeTab",
				requestId: requestId,
				tabId: nextTab.id,
				currentUrl: tab.url,
				screenshot: screenshotDataUrl,
				message: index !== undefined ? `已关闭索引为 ${index} 的标签页` : "已关闭当前标签页",
			}
		} else {
			// 确实没有标签页了
			console.log(`[BG_WS_TABS] 关闭标签页 ${targetTabId} 后没有可用的有效标签页`)
			return {
				status: "success",
				command: "closeTab",
				requestId: requestId,
				message: "已关闭标签页，没有剩余的有效标签页",
			}
		}
	} catch (error) {
		console.error(`[BG_WS_TABS] 关闭标签页出错:`, error)
		throw error
	}
}

/**
 * 等待页面DOM内容可用
 * 使用更高效的方法检测页面是否有可交互的内容，然后检查内容是否稳定
 * @param {number} tabId - 标签页ID
 * @param {number} timeoutMs - 基本DOM可用性检查的超时时间(毫秒)
 * @param {number} checkIntervalMs - 基本DOM可用性检查的间隔(毫秒)
 * @param {string} requestId - 请求ID，用于性能记录
 * @param {number} stabilityTimeoutMs - 内容稳定性检查的超时时间(毫秒)
 * @param {number} stabilityIntervalMs - 内容稳定性检查的间隔(毫秒)
 * @param {number} stabilityIterations - 内容稳定需要的连续相同次数
 * @returns {Promise<boolean>} - 页面是否已有可用内容
 */
export async function waitForDOMAvailable(
	tabId,
	timeoutMs = 5000,
	checkIntervalMs = 200,
	requestId = null,
	stabilityTimeoutMs = 1000,
	stabilityIntervalMs = 100,
	stabilityIterations = 3,
) {
	const startTime = performance.now()
	console.log(
		`[BG_WS_TABS] 等待标签页 ${tabId} DOM内容可用，基本超时: ${timeoutMs}ms, 稳定性检查: ${stabilityTimeoutMs}ms/${stabilityIntervalMs}ms/${stabilityIterations}次`,
	)

	if (requestId) recordCommandStep(requestId, "开始waitForDOMAvailable")

	// 这里先检查一下当前的调试器状态
	const isActuallyAttached = await checkActualDebuggerStatus(tabId)
	const tabDebugState = debuggedTabs.get(tabId)

	// 如果状态不一致，重置状态
	if (tabDebugState && tabDebugState.hasDebugger && !isActuallyAttached) {
		console.log(`[BG_WS_TABS] 调试器状态不一致，重置标签页 ${tabId} 的调试状态`)
		clearTabDebugState(tabId)
	}

	try {
		// 先确保基本DOM可用
		const domAvailable = await waitForBasicDOMAvailable(tabId, timeoutMs, checkIntervalMs)
		if (!domAvailable) {
			console.log(`[BG_WS_TABS] 标签页 ${tabId} 基本DOM不可用，跳过稳定性检查`)
			return false
		}

		console.log(`[BG_WS_TABS] 标签页 ${tabId} 基本DOM已可用，开始检查DOM稳定性`)
		if (requestId) recordCommandStep(requestId, "开始执行DOM稳定性检查")

		// 执行稳定性检查
		await waitTillHTMLStable(tabId, stabilityTimeoutMs, stabilityIntervalMs, stabilityIterations)

		if (requestId) recordCommandStep(requestId, "DOM稳定性检查完成")
		console.log(`[BG_WS_TABS] 标签页 ${tabId} DOM稳定性检查完成`)

		const endTime = performance.now()
		const totalTime = endTime - startTime
		console.log(`[BG_WS_TABS] waitForDOMAvailable函数总耗时: ${totalTime.toFixed(2)}ms`)
		return true
	} catch (error) {
		console.warn(`[BG_WS_TABS] 标签页 ${tabId} DOM稳定性检查出错:`, error)
		// 即使稳定性检查出错，如果基本DOM已可用，也认为成功
		return true
	}
}

/**
 * 等待页面基本DOM内容可用
 * @param {number} tabId - 标签页ID
 * @param {number} timeoutMs - 超时时间(毫秒)
 * @param {number} checkIntervalMs - 检查间隔(毫秒)
 * @returns {Promise<boolean>} - 页面是否已有可用内容
 */
async function waitForBasicDOMAvailable(tabId, timeoutMs = 5000, checkIntervalMs = 200) {
	const startTime = performance.now()

	const result = await new Promise((resolve) => {
		// 设置超时
		const timeout = setTimeout(() => {
			console.log(`[BG_WS_TABS] 标签页 ${tabId} DOM内容等待超时 (${timeoutMs}ms)，继续处理`)
			resolve(false) // 超时也继续处理，返回false表示超时
		}, timeoutMs)

		// 检查页面内容是否可用
		const checkContentAvailable = async () => {
			try {
				// 检查标签页是否存在
				const tab = await chrome.tabs.get(tabId).catch(() => null)
				if (!tab) {
					clearTimeout(timeout)
					console.log(`[BG_WS_TABS] 标签页 ${tabId} 不存在或已关闭`)
					resolve(false)
					return
				}

				// 使用CDP检查DOM状态更可靠
				// 检查是否需要附加调试器
				const { needsDebugger } = await checkTabDebugNeedsWithVerification(tabId)
				if (needsDebugger) {
					try {
						const attachSuccess = await attachDebugger(tabId)
						// 只有在真正成功的情况下才更新状态
						if (attachSuccess) {
							// 更新标签页调试状态，但暂不设置viewport (等后面需要时再设置)
							setTabDebugState(tabId, true, false)
						} else {
							console.warn(`[BG_WS_TABS] 无法附加调试器到标签页 ${tabId}，将在下次检查时重试`)
							setTimeout(checkContentAvailable, checkIntervalMs)
							return
						}
					} catch (err) {
						// 如果无法附加调试器，等待下一次检查
						console.warn(`[BG_WS_TABS] 无法附加调试器到标签页 ${tabId}`, err)
						setTimeout(checkContentAvailable, checkIntervalMs)
						return
					}
				}

				// 检查调试器是否真的附加成功
				const isDebuggerReady = await checkActualDebuggerStatus(tabId)
				if (!isDebuggerReady) {
					// 调试器未就绪，继续等待
					setTimeout(checkContentAvailable, checkIntervalMs)
					return
				}

				// 检查DOM是否可用 - 不一定要等到完全加载
				if (tab.status === "complete" || tab.status === "loading") {
					try {
						// 使用CDP检查DOM内容是否存在
						const evalResult = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
							expression: "document.body && document.body.childElementCount > 0",
						})

						if (evalResult && evalResult.result && evalResult.result.value === true) {
							clearTimeout(timeout)
							const endTime = performance.now()
							const elapsed = endTime - startTime
							console.log(`[BG_WS_TABS] 标签页 ${tabId} 已有可用DOM内容，耗时: ${elapsed.toFixed(2)}ms`)
							resolve(true)
							return
						}
					} catch (evalErr) {
						// 如果调试器命令执行失败，可能是刚附加但还未就绪，或者附加已失效
						console.warn(`[BG_WS_TABS] 检查DOM内容时出错`, evalErr)
						// 重置调试器状态
						if (evalErr.message && evalErr.message.includes("Debugger is not attached")) {
							clearTabDebugState(tabId)
						}
					}
				}

				// 内容不可用，继续检查
				setTimeout(checkContentAvailable, checkIntervalMs)
			} catch (err) {
				// 一般错误，继续检查
				if (err.message && !(err.message.includes("No tab with id") || err.message.includes("Cannot access contents"))) {
					setTimeout(checkContentAvailable, checkIntervalMs)
				} else {
					// 关键错误，停止检查
					clearTimeout(timeout)
					console.warn(`[BG_WS_TABS] 检查标签页 ${tabId} 内容时出错:`, err)
					resolve(false)
				}
			}
		}

		// 开始检查
		checkContentAvailable()
	})

	const endTime = performance.now()
	const totalTime = endTime - startTime
	console.log(`[BG_WS_TABS] waitForBasicDOMAvailable 函数总耗时: ${totalTime.toFixed(2)}ms，结果: ${result}`)

	return result
}

/**
 * 检查标签页的调试器是否真的处于附加状态
 * @param {number} tabId - 标签页ID
 * @returns {Promise<boolean>} - 调试器是否真的附加
 */
async function checkActualDebuggerStatus(tabId) {
	try {
		// 获取所有已附加调试器的目标
		const targets = await chrome.debugger.getTargets()
		// 查找是否存在与该标签页关联的调试器目标
		const hasAttached = targets.some((target) => target.tabId === tabId && target.attached === true)
		console.log(`[BG_WS_TABS] 标签页 ${tabId} 的实际调试器状态: ${hasAttached ? "已附加" : "未附加"}`)
		return hasAttached
	} catch (error) {
		console.error(`[BG_WS_TABS] 检查调试器状态出错:`, error)
		return false
	}
}

/**
 * 带验证的标签页调试需求检查
 * @param {number} tabId - 标签页ID
 * @returns {Promise<Object>} 包含需要附加调试器和应用视口的布尔值
 */
export async function checkTabDebugNeedsWithVerification(tabId) {
	const state = debuggedTabs.get(tabId)
	// 如果没有记录或记录超过5分钟，则认为需要重新设置
	const needsSetup = !state || Date.now() - state.timestamp > 300000

	// 如果状态显示已附加调试器，验证实际状态
	let actuallyAttached = false
	if (state && state.hasDebugger) {
		actuallyAttached = await checkActualDebuggerStatus(tabId)
		// 如果状态不一致，需要清理并重新附加
		if (!actuallyAttached) {
			console.log(`[BG_WS_TABS] 标签页 ${tabId} 调试器状态不一致，需要重新附加`)
			clearTabDebugState(tabId)
		}
	}

	return {
		needsDebugger: needsSetup || !state || !state.hasDebugger || !actuallyAttached,
		needsViewport: needsSetup || !state || !state.hasViewport,
	}
}

/**
 * 设置标签页的调试器状态
 * @param {number} tabId - 标签页ID
 * @param {boolean} hasDebugger - 是否已附加调试器
 * @param {boolean} hasViewport - 是否已应用视口配置
 */
export function setTabDebugState(tabId, hasDebugger = true, hasViewport = true) {
	debuggedTabs.set(tabId, {
		hasDebugger,
		hasViewport,
		timestamp: Date.now(),
	})
	console.log(`[BG_WS_TABS] 标签页 ${tabId} 调试状态已更新: 调试器=${hasDebugger}, 视口=${hasViewport}`)
}

/**
 * 检查标签页是否需要附加调试器和应用视口
 * @param {number} tabId - 标签页ID
 * @returns {Object} 包含需要附加调试器和应用视口的布尔值
 */
export function checkTabDebugNeeds(tabId) {
	const state = debuggedTabs.get(tabId)
	// 如果没有记录或记录超过5分钟，则认为需要重新设置
	const needsSetup = !state || Date.now() - state.timestamp > 300000

	return {
		needsDebugger: needsSetup || !state.hasDebugger,
		needsViewport: needsSetup || !state.hasViewport,
	}
}

/**
 * 清除标签页的调试状态
 * @param {number} tabId - 标签页ID
 */
export function clearTabDebugState(tabId) {
	if (debuggedTabs.has(tabId)) {
		debuggedTabs.delete(tabId)
		console.log(`[BG_WS_TABS] 已清除标签页 ${tabId} 的调试状态`)
	}
}

/**
 * 标签页处理核心函数 - 统一处理所有标签页操作的公共逻辑
 * @param {Object} options - 处理选项
 * @param {number} options.tabId - 标签页ID
 * @param {string} options.operationType - 操作类型，如'navigate', 'click', 'type'等
 * @param {string} options.requestId - 请求ID
 * @param {boolean} options.isBatchMode - 是否为批处理模式，在此模式下跳过截图
 * @param {boolean} options.isNewTab - 是否处理新打开的标签页
 * @param {number} options.originalTabId - 原始标签页ID (对新标签页有效)
 * @param {Function} options.preProcessing - 处理前的回调函数
 * @param {Function} options.postProcessing - 处理后的回调函数
 * @returns {Promise<Object>} - 处理结果，包含截图、URL等信息
 */
export async function processTabCore(options) {
	const {
		tabId,
		operationType,
		requestId,
		isBatchMode = false,
		isNewTab = false,
		originalTabId = null,
		preProcessing = null,
		postProcessing = null,
	} = options

	const startTime = performance.now()
	console.log(
		`[BG_WS_TABS] 开始核心处理 ${operationType} 操作 (tabId: ${tabId}, isBatch: ${isBatchMode}, isNewTab: ${isNewTab})`,
	)
	recordCommandStep(requestId, `开始核心处理${isNewTab ? "新标签页" : "当前标签页"}`)

	try {
		// 前置处理回调
		if (preProcessing && typeof preProcessing === "function") {
			await preProcessing()
		}

		// 设置处理状态为稳定化
		tabProcessingStates.set(tabId, TabProcessingState.STABILIZING)
		console.log(`[BG_WS_TABS] 标签页 ${tabId} 状态更新为: ${TabProcessingState.STABILIZING}`)

		// 等待DOM可用 - 新标签页使用更长的超时时间和间隔
		const domWaitTimeout = isNewTab ? 5000 : 2000
		const domWaitInterval = isNewTab ? 200 : 100
		const domWaitStart = performance.now()
		// 设置不同的稳定性检查参数
		const stabilityTimeout = isNewTab ? 10000 : 1000
		const stabilityInterval = isNewTab ? 200 : 20
		const stabilityIterations = 3
		await waitForDOMAvailable(
			tabId,
			domWaitTimeout,
			domWaitInterval,
			requestId,
			stabilityTimeout,
			stabilityInterval,
			stabilityIterations,
		)
		const domWaitEnd = performance.now()
		console.log(`[BG_WS_TABS] 等待DOM可用耗时: ${(domWaitEnd - domWaitStart).toFixed(2)}ms`)

		// 确保标签页仍然存在
		if (!openedTabIds.has(tabId)) {
			console.log(`[BG_WS_TABS] 标签页 ${tabId} 在处理完成前关闭。`)
			throw new Error(`标签页 ${tabId} 在${operationType}处理过程中关闭。`)
		}

		// 设置处理状态为附加调试器
		tabProcessingStates.set(tabId, TabProcessingState.ATTACHING)
		console.log(`[BG_WS_TABS] 标签页 ${tabId} 状态更新为: ${TabProcessingState.ATTACHING}`)

		// 检查是否需要附加调试器和应用视口
		const debugNeeds = isNewTab ? checkTabDebugNeeds(tabId) : await checkTabDebugNeedsWithVerification(tabId)

		// 附加调试器（如果需要）
		const debugStart = performance.now()
		let debuggerAttached = false
		if (debugNeeds.needsDebugger) {
			debuggerAttached = await attachDebugger(tabId)
			if (debuggerAttached) {
				console.log(`[BG_WS_TABS] 附加调试器到标签页 ${tabId}`)
				setTabDebugState(tabId, true, false) // 暂不设置viewport状态
			} else {
				console.warn(`[BG_WS_TABS] 无法附加调试器到标签页 ${tabId}`)
			}
		} else {
			console.log(`[BG_WS_TABS] 标签页 ${tabId} 已有调试器，跳过附加过程`)
			debuggerAttached = await checkActualDebuggerStatus(tabId)
		}
		const debugEnd = performance.now()
		console.log(`[BG_WS_TABS] 调试器处理耗时: ${(debugEnd - debugStart).toFixed(2)}ms`)
		recordCommandStep(requestId, "调试器处理完成")

		// 应用视口配置（如果需要）
		if (debugTarget && debugTarget.tabId === tabId) {
			const viewportStart = performance.now()
			if (debugNeeds.needsViewport && debuggerAttached) {
				await applyViewportConfig(debugTarget)
				console.log(`[BG_WS_TABS] 应用视口配置到标签页 ${tabId}`)
				setTabDebugState(tabId, true, true) // 更新视口状态
			} else {
				console.log(`[BG_WS_TABS] 标签页 ${tabId} 不需要应用视口配置或调试器未附加`)
			}
			const viewportEnd = performance.now()
			console.log(`[BG_WS_TABS] 视口配置处理耗时: ${(viewportEnd - viewportStart).toFixed(2)}ms`)
			recordCommandStep(requestId, "视口配置处理完成")
		}

		// 获取当前URL
		const getTabStart = performance.now()
		const currentTab = await chrome.tabs.get(tabId)
		const getTabEnd = performance.now()
		console.log(`[BG_WS_TABS] 获取标签页信息耗时: ${(getTabEnd - getTabStart).toFixed(2)}ms`)

		// 只有在非批处理模式下才捕获截图
		let screenshotDataUrl = null
		if (!isBatchMode) {
			// 设置处理状态为捕获
			tabProcessingStates.set(tabId, TabProcessingState.CAPTURING)
			console.log(`[BG_WS_TABS] 标签页 ${tabId} 状态更新为: ${TabProcessingState.CAPTURING}`)

			const screenshotStart = performance.now()
			screenshotDataUrl = await captureVisibleTabPromise(tabId)
			const screenshotEnd = performance.now()
			console.log(`[BG_WS_TABS] 捕获截图耗时: ${(screenshotEnd - screenshotStart).toFixed(2)}ms`)
			recordCommandStep(requestId, "截图捕获完成")
		} else {
			// 批处理模式下跳过截图
			console.log(`[BG_WS_TABS] 批处理模式下跳过截图捕获`)
			recordCommandStep(requestId, "批处理模式：跳过截图")
		}

		// 设置处理状态为完成
		tabProcessingStates.set(tabId, TabProcessingState.COMPLETED)
		console.log(`[BG_WS_TABS] 标签页 ${tabId} 状态更新为: ${TabProcessingState.COMPLETED}`)

		// 后置处理回调
		let additionalData = {}
		if (postProcessing && typeof postProcessing === "function") {
			additionalData = (await postProcessing()) || {}
		}

		const endTime = performance.now()
		const totalTime = endTime - startTime
		console.log(`[BG_WS_TABS] 核心处理函数总耗时: ${totalTime.toFixed(2)}ms`)
		recordCommandStep(requestId, `处理完成(${totalTime.toFixed(2)}ms)`)

		// 基本结果对象
		const result = {
			status: "success",
			command: operationType,
			requestId: requestId,
			screenshot: screenshotDataUrl,
			currentUrl: currentTab.url,
			navigationOccurred: isNewTab,
			...additionalData,
		}

		// 如果是新标签页，添加相关信息
		if (isNewTab) {
			result.newTabOpened = true
			result.originalTabId = originalTabId
			result.newTabId = tabId
		}

		return result
	} catch (error) {
		console.error(`[BG_WS_TABS] 核心处理函数出错:`, error)
		tabProcessingStates.set(tabId, TabProcessingState.IDLE)
		throw error
	}
}
