import { debugTarget } from "./debuggerService.js"
import { getModifiersBitmask } from "../utils/browserUtils.js"
import * as visualizationHandler from "../handlers/visualizationHandler.js"
import * as domUtils from "../utils/domUtils.js"
import * as screenshotService from "./screenshotService.js"
// 导入增强键盘服务
import { pressKeyOnActiveTab, pressKeyCombinationOnActiveTab } from "./keyboardService.js"
// 导入tabService用于获取activeTabId
import { getActiveTabId } from "../services/tabService.js"

/**
 * 执行鼠标点击操作
 * @param {string} coordinateString - 坐标字符串，格式为 "x,y"
 * @returns {Promise<void>}
 */
export async function performClick(coordinateString) {
	// 获取当前活动标签页ID
	const tabId = getActiveTabId()
	if (!tabId) {
		throw new Error("无可用的标签页执行点击操作")
	}

	// 直接解析坐标字符串
	const [cssX, cssY] = coordinateString.split(",").map(Number)
	if (isNaN(cssX) || isNaN(cssY)) {
		throw new Error(`无效的坐标格式: ${coordinateString}，应为 "x,y"`)
	}

	console.log(`[BG_WS] Performing click at ${cssX},${cssY} on tab ${tabId}`)

	if (!debugTarget || debugTarget.tabId !== tabId) {
		throw new Error(`Debugger not attached to tab ${tabId} for click operation`)
	}

	const clickTarget = { tabId: tabId }

	// 首先执行可视化动画，如果有错误不阻断主操作流程
	let visualizationSuccess = false
	let timeoutTriggered = false
	let timeoutId = null

	try {
		// 使用更简单的超时机制
		const animationPromise = visualizationHandler.executeMouseClick(tabId, cssX, cssY)

		// 创建一个定时器Promise
		const timeoutPromise = new Promise((resolve) => {
			timeoutId = setTimeout(() => {
				timeoutTriggered = true
				console.warn(`[BG_WS] 鼠标可视化超时(5秒)，继续执行点击操作`)
				resolve(false)
			}, 5000)
		})

		// 使用Promise.race并等待结果
		visualizationSuccess = await Promise.race([animationPromise, timeoutPromise])

		// 如果动画先完成，取消超时
		if (timeoutId) {
			clearTimeout(timeoutId)
			timeoutId = null
		}

		// 记录适当的日志
		if (visualizationSuccess && !timeoutTriggered) {
			//console.log(`[BG_WS] 鼠标可视化成功完成，继续执行点击操作`)
		} else if (timeoutTriggered) {
			console.warn(`[BG_WS] 鼠标可视化因超时而中断，继续执行点击操作`)
		} else {
			console.error(`[BG_WS] 鼠标可视化失败，继续执行点击操作`)
		}
	} catch (error) {
		// 清理超时
		if (timeoutId) {
			clearTimeout(timeoutId)
			timeoutId = null
		}
		console.warn(`[BG_WS] 鼠标可视化出错: ${error.message}，继续执行点击操作`)
		// 即使可视化失败，也继续进行点击操作
	}

	// 如果可视化成功，增加短暂延迟让用户看到动画
	if (visualizationSuccess && !timeoutTriggered) {
		await new Promise((resolve) => setTimeout(resolve, 300))
	}

	// 发送鼠标事件
	try {
		await chrome.debugger.sendCommand(clickTarget, "Input.dispatchMouseEvent", {
			type: "mousePressed",
			x: cssX,
			y: cssY,
			button: "left",
			clickCount: 1,
		})

		await chrome.debugger.sendCommand(clickTarget, "Input.dispatchMouseEvent", {
			type: "mouseReleased",
			x: cssX,
			y: cssY,
			button: "left",
			clickCount: 1,
		})

		//console.log(`[BG_WS] Dispatched mouse click event (CSS: ${cssX},${cssY}) to tab ${tabId}`)
	} catch (error) {
		console.error(`[BG_WS] 点击操作出错: ${error.message}`)
		throw new Error(`点击操作失败: ${error.message}`)
	}
}

/**
 * 执行文本输入
 * @param {string} text - 要输入的文本
 * @returns {Promise<void>}
 */
export async function performType(text) {
	// 获取当前活动标签页ID
	const tabId = getActiveTabId()
	if (!tabId) {
		throw new Error("无可用的标签页执行输入操作")
	}

	console.log(`[BG_WS] Typing text (length: ${text?.length}) on tab ${tabId}`)

	const typeTarget = { tabId: tabId }
	const typeProtocolVersion = "1.3"

	// 附加调试器（如果尚未附加）
	if (!debugTarget || debugTarget.tabId !== tabId) {
		if (debugTarget) {
			try {
				await chrome.debugger.detach(debugTarget)
			} catch (e) {
				console.warn(`[BG_WS] Error detaching previous debug target ${debugTarget.tabId}:`, e)
			}
		}
		await chrome.debugger.attach(typeTarget, typeProtocolVersion)
		debugTarget = typeTarget
		console.log(`[BG_WS] Attached debugger to tab ${tabId} for typing.`)
	} else {
		console.log(`[BG_WS] Debugger already attached to tab ${tabId} for typing.`)
	}

	// 插入文本
	console.log(`[BG_WS] Dispatching key events for text: ${text}`)
	await chrome.debugger.sendCommand(typeTarget, "Input.insertText", {
		text: text,
	})

	console.log(`[BG_WS] Finished dispatching insertText event for tab ${tabId}`)
}

/**
 * 执行按键操作
 * @param {string} key - 要按的键
 * @returns {Promise<void>}
 */
export async function performPressKey(key) {
	console.log(`[BG_WS] Pressing key: ${key}`)

	try {
		// 使用无tabId参数的增强版键盘服务
		await pressKeyOnActiveTab(key)
		console.log(`[BG_WS] Dispatched key events successfully`)
	} catch (error) {
		console.error(`[BG_WS] Error in performPressKey: ${error.message}`)
		throw error
	}
}

/**
 * 执行组合键操作
 * @param {string} combination - 组合键 "Control+C"
 * @returns {Promise<void>}
 */
export async function performKeyCombination(combination) {
	console.log(`[BG_WS] Pressing combination: ${combination}`)

	try {
		// 使用无tabId参数的增强版键盘服务
		await pressKeyCombinationOnActiveTab(combination)
		console.log(`[BG_WS] Dispatched key combination events successfully`)
	} catch (error) {
		console.error(`[BG_WS] Error in performKeyCombination: ${error.message}`)
		throw error
	}
}
