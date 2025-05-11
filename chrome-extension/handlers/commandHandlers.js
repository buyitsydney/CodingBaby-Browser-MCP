/**
 * 命令处理模块
 * 警告：本模块依赖其他所有模块，应该最后加载以避免循环依赖
 */

import { sendMessageToServer, recordCommandStep } from "../services/websocketService.js"
import {
	handleNavigate,
	waitForTabOperationComplete,
	performSimpleOperation,
	closeAllTabs,
	getTabList,
	createNewTab,
	selectTab,
	closeTabByIndex,
	getActiveTabId,
} from "../services/tabService.js"
import { captureVisibleTabPromise, captureAreaScreenshot } from "../services/screenshotService.js"
import { performClick, performKeyCombination, performPressKey, performType } from "../services/interactionService.js"
import { performScroll } from "../services/scrollService.js"
import { getFullHtml, getViewportSize } from "../services/contentService.js"
import { updateViewportConfig, applyViewportConfig } from "../services/viewportService.js"
import { debugTarget, attachDebugger, isDebuggerAttached } from "../services/debuggerService.js"
import { handleBatchCommand } from "./batchCommandHandler.js"
import { executeAreaVisualization } from "./visualizationHandler.js"

/**
 * 处理从服务器接收的命令
 * @param {Object} message - 收到的消息对象
 */
export async function handleCommandFromServer(message) {
	// 过滤掉带有自己来源的消息
	if (message.source === "chromeExtension") {
		console.warn("[BG_WS] Ignoring message with own source.")
		return
	}

	console.log("[BG_WS] Received command from server:", message)

	// 处理视口配置消息
	if (message.command === "setViewportConfig" && message.viewport) {
		console.log("[BG_WS] Received viewport configuration:", message.viewport)
		updateViewportConfig(message.viewport)

		// 如果有活动的debugTarget，立即应用新配置
		if (debugTarget) {
			try {
				await applyViewportConfig(debugTarget)
				console.log("[BG_WS] Applied new viewport configuration to current debug target:", debugTarget.tabId)
				sendMessageToServer({
					status: "ack",
					command: "setViewportConfig",
				})
			} catch (error) {
				console.error("[BG_WS] Error applying new viewport configuration:", error)
				sendMessageToServer({
					status: "error",
					command: "setViewportConfig",
					message: error.message,
				})
			}
		} else {
			sendMessageToServer({
				status: "ack",
				command: "setViewportConfig",
				message: "Viewport configuration updated but no active debug target to apply to.",
			})
		}
		return
	}

	// 处理命令
	switch (message.command) {
		case "navigateToUrl":
			// 处理导航命令
			await handleNavigate(message.url, message.requestId || "from_backend", message.command, message)
			break
		case "close":
			await handleCloseCommand(message)
			break
		case "scroll":
			await handleScrollCommand(message)
			break
		case "type":
			await handleTypeCommand(message)
			break
		case "pressKey":
			await handlePressKeyCommand(message)
			break
		case "pressKeyCombination":
			await handleKeyCombinationCommand(message)
			break
		case "getFullHtml":
			await handleGetFullHtmlCommand(message)
			break
		case "click":
			await handleClickCommand(message)
			break
		case "get_viewport_size":
			await handleGetViewportSizeCommand(message)
			break
		case "takeAreaScreenshot":
			await handleTakeAreaScreenshotCommand(message)
			break
		case "wait":
			await handleWaitCommand(message)
			break
		// 标签页管理命令
		case "listTabs":
			await handleListTabsCommand(message)
			break
		case "newTab":
			await handleNewTabCommand(message)
			break
		case "selectTab":
			await handleSelectTabCommand(message)
			break
		case "closeTab":
			await handleCloseTabCommand(message)
			break
		case "navigateBack":
			await handleNavigateBackCommand(message)
			break
		case "navigateForward":
			await handleNavigateForwardCommand(message)
			break
		// 批处理命令
		case "batch":
			await handleBatchCommand(message)
			break
		default:
			console.warn("[BG_WS] Received unknown command from server:", message)
			sendMessageToServer({
				status: "error",
				message: `未知命令: ${message.command}`,
				command: message.command,
				requestId: message.requestId,
			})
	}
}

/**
 * 处理关闭命令
 * @param {Object} message - 命令消息
 */
async function handleCloseCommand(message) {
	const closeRequestId = message.requestId
	console.log(`[BG_WS] Received close command (request: ${closeRequestId})`)

	try {
		// 使用新的tabService封装函数关闭标签页
		const result = await closeAllTabs(closeRequestId)
		sendMessageToServer(result)
	} catch (error) {
		console.error(`[BG_WS] Error processing close command:`, error)
		sendMessageToServer({
			status: "error",
			message: error.message,
			command: "close",
			requestId: closeRequestId,
		})
	}
}

/**
 * 处理滚动命令
 * @param {Object} message - 命令消息
 */
async function handleScrollCommand(message) {
	const scrollRequestId = message.requestId
	const { direction, selector } = message

	console.log(
		`[BG_WS] Received scroll command (request: ${scrollRequestId}, direction: ${direction}, selector: ${selector || "null"})`,
	)

	if (!direction || !["up", "down", "left", "right"].includes(direction)) {
		console.error(`[BG_WS] 无效的滚动方向: ${direction}`)
		sendMessageToServer({
			status: "error",
			error: `无效的滚动方向: ${direction}`,
			requestId: scrollRequestId,
		})
		return
	}

	try {
		// 使用简单操作处理函数进行滚动
		const result = await performSimpleOperation("scroll", scrollRequestId, async () => {
			// 使用新的scrollService中的performScroll函数
			await performScroll(direction, selector)
		})

		// 发送结果给服务器
		sendMessageToServer(result)
	} catch (error) {
		console.error(`[BG_WS] 滚动执行失败: ${error.message}`)
		sendMessageToServer({
			status: "error",
			error: error.message || "Scrolling failed with an unknown error",
			requestId: scrollRequestId,
		})
	}
}

/**
 * 处理文本输入命令
 * @param {Object} message - 命令消息
 */
async function handleTypeCommand(message) {
	const typeRequestId = message.requestId
	const textToType = message.text

	console.log(`[BG_WS] Received type command (request: ${typeRequestId}, text length: ${textToType?.length})`)

	try {
		// 使用简单操作处理函数，不等待导航或新标签页
		const result = await performSimpleOperation(
			"type", // 操作类型
			typeRequestId, // 请求ID
			async () => {
				// 实际执行的输入操作
				await performType(textToType)
				// 添加短暂延迟让输入完成
				await new Promise((resolve) => setTimeout(resolve, 100))
			},
		)

		// 发送结果给服务器
		sendMessageToServer(result)
	} catch (error) {
		console.error(`[BG_WS] Error processing type command:`, error)
		sendMessageToServer({
			status: "error",
			message: error.message,
			command: "type",
			requestId: typeRequestId,
		})
	}
}

/**
 * 处理按键命令
 * @param {Object} message - 命令消息
 */
async function handlePressKeyCommand(message) {
	const pressKeyRequestId = message.requestId
	const keyToPress = message.key

	console.log(`[BG_WS] Received pressKey command (request: ${pressKeyRequestId}, key: ${keyToPress})`)

	try {
		// 使用通用的标签页操作函数进行按键和处理
		const result = await waitForTabOperationComplete(
			"pressKey", // 操作类型
			pressKeyRequestId, // 请求ID
			async () => {
				// 实际执行的按键操作，无需关心activeTabId
				await performPressKey(keyToPress)
			},
		)

		// 发送结果给服务器
		sendMessageToServer(result)
	} catch (error) {
		console.error(`[BG_WS] Error processing pressKey command ${pressKeyRequestId}:`, error)
		sendMessageToServer({
			status: "error",
			message: error.message,
			command: "pressKey",
			requestId: pressKeyRequestId,
		})
	}
}

/**
 * 处理组合键命令
 * @param {Object} message - 命令消息
 */
async function handleKeyCombinationCommand(message) {
	const comboRequestId = message.requestId
	const combination = message.combination // 例如，"Control+C"

	console.log(`[BG_WS] Received pressKeyCombination command (request: ${comboRequestId}, combination: ${combination})`)

	try {
		// 使用简单操作处理函数，不等待导航或新标签页
		const result = await performSimpleOperation(
			"pressKeyCombination", // 操作类型
			comboRequestId, // 请求ID
			async () => {
				// 实际执行的组合键操作
				await performKeyCombination(combination)
				// 添加短暂延迟让组合键完成
				await new Promise((resolve) => setTimeout(resolve, 100))
			},
		)

		// 发送结果给服务器
		sendMessageToServer(result)
	} catch (error) {
		console.error(`[BG_WS] Error processing pressKeyCombination command:`, error)
		sendMessageToServer({
			status: "error",
			message: error.message,
			command: "pressKeyCombination",
			requestId: comboRequestId,
		})
	}
}

/**
 * 处理获取完整HTML命令
 * @param {Object} message - 命令消息
 */
async function handleGetFullHtmlCommand(message) {
	const getHtmlRequestId = message.requestId

	console.log(`[BG_WS] Received getFullHtml command (request: ${getHtmlRequestId})`)

	try {
		// 使用简单操作处理函数获取HTML
		const result = await performSimpleOperation("getFullHtml", getHtmlRequestId, async () => {
			// getFullHtml会自己获取活动标签页
			const htmlContent = await getFullHtml()
			return { htmlContent }
		})

		// 添加HTML内容到结果中
		sendMessageToServer({
			...result,
			htmlContent: result.htmlContent,
		})
	} catch (error) {
		console.error(`[BG_WS] Error processing getFullHtml command:`, error)
		sendMessageToServer({
			status: "error",
			command: "getFullHtml",
			requestId: getHtmlRequestId,
			message: error.message || String(error),
		})
	}
}

/**
 * 处理点击命令
 * @param {Object} message - 命令消息
 */
async function handleClickCommand(message) {
	const clickRequestId = message.requestId
	const coordinateString = message.coordinate

	console.log(`[BG_WS] Received click command (request: ${clickRequestId}, coordinates: ${coordinateString})`)

	try {
		// 使用通用的标签页操作函数进行点击和处理
		const result = await waitForTabOperationComplete(
			"click", // 操作类型
			clickRequestId, // 请求ID
			async () => {
				// 实际执行的点击操作，无需关心activeTabId
				await performClick(coordinateString)
			},
		)

		// 发送结果给服务器
		sendMessageToServer(result)
	} catch (error) {
		console.error(`[BG_WS] Error processing click command ${clickRequestId}:`, error)
		sendMessageToServer({
			status: "error",
			message: error.message,
			command: "click",
			requestId: clickRequestId,
		})
	}
}

/**
 * 处理获取视口大小命令
 * @param {Object} message - 命令消息
 */
async function handleGetViewportSizeCommand(message) {
	const getSizeRequestId = message.requestId

	console.log(`[BG_WS] Received get_viewport_size command (request: ${getSizeRequestId})`)

	try {
		// 使用简单操作处理函数获取视口大小
		const result = await performSimpleOperation("get_viewport_size", getSizeRequestId, async () => {
			// getViewportSize会自己获取活动标签页
			const viewportSize = await getViewportSize()
			return { viewportSize }
		})

		// 添加视口大小到结果中
		sendMessageToServer({
			...result,
			viewportSize: result.viewportSize,
		})
	} catch (error) {
		console.error(`[BG_WS] Error processing get_viewport_size command:`, error)
		sendMessageToServer({
			status: "error",
			message: error.message,
			command: "get_viewport_size",
			requestId: getSizeRequestId,
		})
	}
}

/**
 * 处理区域截图命令
 * @param {Object} message - 命令消息
 */
async function handleTakeAreaScreenshotCommand(message) {
	const screenshotRequestId = message.requestId
	const topLeft = message.topLeft
	const bottomRight = message.bottomRight

	console.log(
		`[BG_WS] Received takeAreaScreenshot command (request: ${screenshotRequestId}, topLeft: ${topLeft}, bottomRight: ${bottomRight})`,
	)

	// 验证坐标
	if (!topLeft || !bottomRight) {
		sendMessageToServer({
			status: "error",
			message: "Missing coordinates for takeAreaScreenshot command",
			command: "takeAreaScreenshot",
			requestId: screenshotRequestId,
		})
		return
	}

	try {
		// 获取活动标签页ID
		const activeTabId = getActiveTabId()
		if (!activeTabId) {
			throw new Error("无可用的标签页执行区域截图")
		}

		// 执行区域可视化
		try {
			console.log(`[BG_WS] Executing area visualization for request ${screenshotRequestId}`)
			await executeAreaVisualization(topLeft, bottomRight)
			// 等待一小段时间，让用户能看到效果，但不阻塞截图太久
			await new Promise((resolve) => setTimeout(resolve, 500))
		} catch (vizError) {
			console.warn(`[BG_WS] Area visualization failed, proceeding with screenshot:`, vizError)
			// 可视化失败不应阻止截图
		}

		// 捕获区域截图
		const screenshot = await captureAreaScreenshot(topLeft, bottomRight)
		if (!screenshot) {
			throw new Error("Failed to capture area screenshot")
		}

		// 获取当前URL
		const tab = await chrome.tabs.get(activeTabId)
		const currentUrl = tab.url

		// 直接发送结果
		sendMessageToServer({
			status: "success",
			command: "takeAreaScreenshot",
			requestId: screenshotRequestId,
			screenshot: screenshot,
			currentUrl: currentUrl,
		})
	} catch (error) {
		console.error(`[BG_WS] Error processing takeAreaScreenshot command: ${error.message}`, error)
		sendMessageToServer({
			status: "error",
			message: error.message,
			command: "takeAreaScreenshot",
			requestId: screenshotRequestId,
		})
	}
}

/**
 * 处理等待命令
 * @param {Object} message - 命令消息
 */
async function handleWaitCommand(message) {
	const waitRequestId = message.requestId
	const waitSeconds = message.seconds

	console.log(`[BG_WS] Received wait command (request: ${waitRequestId}, seconds: ${waitSeconds})`)

	// 检查等待时间是否合理
	const waitTimeMs = Number(waitSeconds) * 1000
	if (isNaN(waitTimeMs) || waitTimeMs <= 0) {
		sendMessageToServer({
			status: "error",
			message: `Invalid wait time: ${waitSeconds}. Must be a positive number.`,
			command: "wait",
			requestId: waitRequestId,
		})
		return
	}

	try {
		// 使用简单操作处理函数执行等待
		const result = await performSimpleOperation("wait", waitRequestId, async () => {
			console.log(`[BG_WS] Waiting for ${waitSeconds} seconds (request: ${waitRequestId})...`)
			// 执行等待
			await new Promise((resolve) => setTimeout(resolve, waitTimeMs))
			console.log(`[BG_WS] Wait completed for ${waitRequestId}.`)
		})

		// 添加等待消息到结果中
		sendMessageToServer({
			...result,
			message: `Waited for ${waitSeconds} seconds`,
		})
	} catch (error) {
		console.error(`[BG_WS] Error processing wait command ${waitRequestId}:`, error)
		sendMessageToServer({
			status: "error",
			message: error.message,
			command: "wait",
			requestId: waitRequestId,
		})
	}
}

/**
 * 处理获取标签页列表命令
 * @param {Object} message - 命令消息
 */
async function handleListTabsCommand(message) {
	const listTabsRequestId = message.requestId

	console.log(`[BG_WS] Received listTabs command (request: ${listTabsRequestId})`)

	try {
		// 使用新的tabService函数获取标签页列表
		const result = await getTabList(listTabsRequestId)
		sendMessageToServer(result)
	} catch (error) {
		console.error(`[BG_WS] Error processing listTabs command:`, error)
		sendMessageToServer({
			status: "error",
			message: error.message,
			command: "listTabs",
			requestId: listTabsRequestId,
		})
	}
}

/**
 * 处理新建标签页命令
 * @param {Object} message - 命令消息
 */
async function handleNewTabCommand(message) {
	const newTabRequestId = message.requestId
	const url = message.url || "about:blank"

	console.log(`[BG_WS] Received newTab command (request: ${newTabRequestId}, url: ${url})`)

	try {
		// 使用新的tabService函数创建标签页
		const result = await createNewTab(newTabRequestId, url)
		sendMessageToServer(result)
	} catch (error) {
		console.error(`[BG_WS] Error processing newTab command:`, error)
		sendMessageToServer({
			status: "error",
			message: error.message,
			command: "newTab",
			requestId: newTabRequestId,
		})
	}
}

/**
 * 处理选择标签页命令
 * @param {Object} message - 命令消息
 */
async function handleSelectTabCommand(message) {
	const selectTabRequestId = message.requestId
	const index = message.index

	console.log(`[BG_WS] Received selectTab command (request: ${selectTabRequestId}, index: ${index})`)

	try {
		// 使用新的tabService函数选择标签页
		const result = await selectTab(selectTabRequestId, index)
		sendMessageToServer(result)
	} catch (error) {
		console.error(`[BG_WS] Error processing selectTab command:`, error)
		sendMessageToServer({
			status: "error",
			message: error.message,
			command: "selectTab",
			requestId: selectTabRequestId,
		})
	}
}

/**
 * 处理关闭标签页命令
 * @param {Object} message - 命令消息
 */
async function handleCloseTabCommand(message) {
	const closeTabRequestId = message.requestId
	const index = message.index

	console.log(`[BG_WS] Received closeTab command (request: ${closeTabRequestId}, index: ${index})`)

	try {
		// 使用新的tabService函数关闭标签页
		const result = await closeTabByIndex(closeTabRequestId, index)
		sendMessageToServer(result)
	} catch (error) {
		console.error(`[BG_WS] Error processing closeTab command:`, error)
		sendMessageToServer({
			status: "error",
			message: error.message,
			command: "closeTab",
			requestId: closeTabRequestId,
		})
	}
}
