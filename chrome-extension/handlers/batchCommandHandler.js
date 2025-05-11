/**
 * 批处理命令处理模块
 * 用于处理多个操作的批量执行
 */

import { sendMessageToServer } from "../services/websocketService.js"
import { captureVisibleTabPromise, captureVisibleTabState } from "../services/screenshotService.js"
import { waitTillHTMLStable } from "../utils/domUtils.js"
import { performClick, performType, performPressKey, performKeyCombination } from "../services/interactionService.js"
import { performScroll } from "../services/scrollService.js"
import {
	openedTabIds,
	tabProcessingStates,
	getActiveTabId,
	waitForTabOperationComplete,
	performSimpleOperation,
} from "../services/tabService.js"

/**
 * 处理批处理命令
 * @param {Object} message - 命令消息
 */
export async function handleBatchCommand(message) {
	const batchRequestId = message.requestId
	const operations = message.operations || []
	const intervalMs = message.interval_ms || 100

	console.log(
		`[BG_WS] Received batch command (request: ${batchRequestId}, operations: ${operations.length}, interval: ${intervalMs}ms)`,
	)

	// 确保有操作要执行
	if (!operations || operations.length === 0) {
		sendMessageToServer({
			status: "error",
			message: "No operations provided for batch command",
			command: "batch",
			requestId: batchRequestId,
		})
		return
	}

	// 获取当前活动标签页ID
	const targetTabId = getActiveTabId()
	if (!targetTabId) {
		sendMessageToServer({
			status: "error",
			message: "无可用的标签页执行批处理命令",
			command: "batch",
			requestId: batchRequestId,
		})
		return
	}

	try {
		// 设置标签页处理状态为批处理中
		tabProcessingStates.set(targetTabId, "batch_processing")
		console.log(`[BG_WS] Set tab ${targetTabId} to batch_processing state`)

		let currentTabId = targetTabId // 当前操作的标签页ID，可能会变化
		const results = []

		// 依次执行每个操作
		for (let i = 0; i < operations.length; i++) {
			const operation = operations[i]
			console.log(`[BG_WS] Executing batch operation ${i + 1}/${operations.length}: ${operation.name}`)

			try {
				// 执行操作并获取结果
				const operationResult = await executeOperation(operation, batchRequestId, intervalMs)
				results.push({
					...operation,
					status: "success",
					result: operationResult,
				})

				// 安全地检查是否打开了新标签页
				if (operationResult && operationResult.newTabOpened === true && operationResult.newTabId) {
					console.log(`[BG_WS] Operation ${operation.name} opened new tab ${operationResult.newTabId}, switching to it`)
					currentTabId = operationResult.newTabId
				}
			} catch (error) {
				console.error(`[BG_WS] Error executing batch operation ${operation.name}:`, error)
				results.push({
					...operation,
					status: "error",
					error: error.message,
				})

				// 出错后停止执行后续操作
				break
			}

			// 在操作之间添加间隔
			if (i < operations.length - 1) {
				await new Promise((resolve) => setTimeout(resolve, intervalMs))
			}
		}

		// 重置标签页处理状态
		tabProcessingStates.delete(targetTabId)
		if (currentTabId !== targetTabId) {
			tabProcessingStates.delete(currentTabId)
		}

		// 确保最终使用的标签页仍然存在
		if (!openedTabIds.has(currentTabId)) {
			console.log(`[BG_WS] Tab ${currentTabId} no longer exists after batch operations`)
			sendMessageToServer({
				status: "success",
				command: "batch",
				requestId: batchRequestId,
				operations: results,
				message: "Batch operations completed, but tab no longer exists",
			})
			return
		}

		// 等待DOM稳定
		//await waitTillHTMLStable(currentTabId)

		// 捕获截图
		const screenshotDataUrl = await captureVisibleTabPromise(currentTabId)

		// 获取当前URL
		const tab = await chrome.tabs.get(currentTabId)

		sendMessageToServer({
			status: "success",
			command: "batch",
			requestId: batchRequestId,
			operations: results,
			screenshot: screenshotDataUrl,
			currentUrl: tab.url,
			message: `Executed ${operations.length} operations in batch`,
			tabId: currentTabId,
		})
	} catch (error) {
		console.error(`[BG_WS] Error processing batch command:`, error)

		// 重置标签页处理状态
		if (targetTabId) {
			tabProcessingStates.delete(targetTabId)
		}

		sendMessageToServer({
			status: "error",
			message: error.message,
			command: "batch",
			requestId: batchRequestId,
		})
	}
}

/**
 * 执行单个批处理操作
 * @param {Object} operation - 要执行的操作
 * @param {string} requestId - 请求ID
 * @param {number} intervalMs - 操作间隔
 * @returns {Promise<Object>} - 操作结果
 */
async function executeOperation(operation, requestId, intervalMs) {
	const { name, parameters } = operation
	let result = null

	// 为每个操作生成唯一的子请求ID
	const operationRequestId = `${requestId}_${name}_${Date.now()}`

	switch (name) {
		case "click":
			// 从parameters.coordinate中提取坐标字符串
			if (!parameters || !parameters.coordinate) {
				throw new Error("Click operation requires 'coordinate' parameter")
			}

			// 使用waitForTabOperationComplete处理可能导致导航的点击
			// 传入true表示这是批处理模式，跳过截图
			result = await waitForTabOperationComplete(
				"click",
				operationRequestId,
				async () => {
					await performClick(parameters.coordinate)
				},
				true,
			)
			break

		case "type":
			// 从parameters.text中提取文本
			if (!parameters || !parameters.text) {
				throw new Error("Type operation requires 'text' parameter")
			}

			// 使用performSimpleOperation处理文本输入（不导航）
			// 传入true表示这是批处理模式，跳过截图
			result = await performSimpleOperation(
				"type",
				operationRequestId,
				async () => {
					await performType(parameters.text)
					// 添加短暂延迟让输入完成
					await new Promise((resolve) => setTimeout(resolve, 100))
				},
				true,
			)
			break

		case "press_key":
			// 从parameters.key中提取按键
			if (!parameters || !parameters.key) {
				throw new Error("Press key operation requires 'key' parameter")
			}

			// 使用waitForTabOperationComplete处理可能导致导航的按键
			// 传入true表示这是批处理模式，跳过截图
			result = await waitForTabOperationComplete(
				"pressKey",
				operationRequestId,
				async () => {
					await performPressKey(parameters.key)
				},
				true,
			)
			break

		case "press_key_combo":
			// 从parameters.combination中提取组合键
			if (!parameters || !parameters.combination) {
				throw new Error("Key combination operation requires 'combination' parameter")
			}

			// 使用performSimpleOperation处理组合键（一般不导航）
			// 传入true表示这是批处理模式，跳过截图
			result = await performSimpleOperation(
				"pressKeyCombination",
				operationRequestId,
				async () => {
					await performKeyCombination(parameters.combination)
					// 添加短暂延迟让组合键完成
					await new Promise((resolve) => setTimeout(resolve, 100))
				},
				true,
			)
			break

		case "scroll":
			// 从parameters中提取滚动方向和选择器
			if (!parameters || !parameters.direction) {
				throw new Error("Scroll operation requires 'direction' parameter")
			}

			// 使用performSimpleOperation处理滚动（不导航）
			// 传入true表示这是批处理模式，跳过截图
			result = await performSimpleOperation(
				"scroll",
				operationRequestId,
				async () => {
					await performScroll(parameters.direction, parameters.selector)
				},
				true,
			)
			break

		case "wait":
			const waitTime = (parameters?.seconds || 1) * 1000 || intervalMs

			// 使用performSimpleOperation处理等待（不导航）
			// 传入true表示这是批处理模式，跳过截图
			result = await performSimpleOperation(
				"wait",
				operationRequestId,
				async () => {
					await new Promise((resolve) => setTimeout(resolve, waitTime))
				},
				true,
			)
			break

		default:
			throw new Error(`Unsupported operation: ${name}`)
	}

	return result
}
