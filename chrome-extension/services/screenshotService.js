import { debugTarget, isDebuggerAttached } from "./debuggerService.js"
import { getActiveTabId } from "../services/tabService.js"

/**
 * 捕获标签页状态（截图、URL）
 * @param {number} tabId - 标签页ID
 * @returns {Promise<Object>} 状态对象 {screenshot, currentUrl, tabId}
 */
export async function captureVisibleTabState(tabId) {
	console.log(`[BG_WS_STATE] Capturing state for tab ${tabId}`)
	try {
		// 确保标签页仍然存在
		const tab = await chrome.tabs.get(tabId)
		if (!tab) {
			throw new Error(`Tab ${tabId} not found during state capture.`)
		}

		// 捕获截图
		const screenshotDataUrl = await captureVisibleTabPromise(tabId)

		return {
			screenshot: screenshotDataUrl,
			currentUrl: tab.url,
			tabId: tabId,
		}
	} catch (error) {
		console.error(`[BG_WS_STATE] Error capturing state for tab ${tabId}:`, error)
		// 重新抛出错误，让调用者处理
		throw error
	}
}

/**
 * 使用Chrome调试协议捕获标签页截图
 * @param {number} targetTabId - 标签页ID
 * @returns {Promise<string>} 截图的Data URL
 */
export async function captureVisibleTabPromise(targetTabId) {
	// 验证参数
	if (!targetTabId) {
		console.error(`[BG_WS_SS_CDP] Invalid tab ID for screenshot: ${targetTabId}`)
		return null
	}

	// 验证标签页是否存在
	try {
		await chrome.tabs.get(targetTabId)
	} catch (error) {
		console.error(`[BG_WS_SS_CDP] Tab ${targetTabId} does not exist for screenshot: ${error.message}`)
		return null
	}

	// 确认调试器是否真的附加到目标标签页
	const isAttached = await isDebuggerAttached(targetTabId)
	if (!isAttached) {
		console.error(`[BG_WS_SS_CDP] Cannot capture screenshot: Debugger not actually attached to tab ${targetTabId}.`)
		return null
	}

	// 检查全局debugTarget状态是否与实际状态一致
	if (!debugTarget || debugTarget.tabId !== targetTabId) {
		console.error(
			`[BG_WS_SS_CDP] Debugger target mismatch. Target in state: ${debugTarget?.tabId}, actual target: ${targetTabId}`,
		)
		return null
	}

	// 执行截图
	try {
		// 允许指定格式和质量
		const format = "jpeg" // png
		const quality = 100 // 默认最高质量

		const screenshotResult = await chrome.debugger.sendCommand({ tabId: targetTabId }, "Page.captureScreenshot", {
			format: format,
			quality: quality,
			fromSurface: true,
		})

		if (screenshotResult && screenshotResult.data) {
			const dataLength = screenshotResult.data.length
			console.log(
				`[BG_WS_SS_CDP] Successfully captured screenshot via CDP for tab ${targetTabId}. Format: ${format}, Quality: ${quality}, Data length: ${dataLength}`,
			)

			// 根据实际格式动态设置MIME类型
			const mimeType = format.toLowerCase() === "jpeg" ? "image/jpeg" : "image/png"
			return `data:${mimeType};base64,` + screenshotResult.data
		} else {
			console.error(`[BG_WS_SS_CDP] CDP Page.captureScreenshot for tab ${targetTabId} returned no data.`)
			return null
		}
	} catch (error) {
		console.error(`[BG_WS_SS_CDP] Error capturing screenshot via CDP for tab ${targetTabId}: ${error.message}`)
		return null
	}
}

/**
 * 使用Chrome调试协议捕获屏幕特定区域的截图
 * @param {number} targetTabId - 标签页ID
 * @param {string} topLeft - 左上角坐标，格式为"x,y"
 * @param {string} bottomRight - 右下角坐标，格式为"x,y"
 * @returns {Promise<string>} 截图的Data URL
 */
export async function captureAreaScreenshot(topLeft, bottomRight) {
	// 获取当前活动标签页ID
	const activeTabId = getActiveTabId()
	if (!activeTabId) {
		throw new Error("无可用的标签页执行区域截图")
	}

	if (!topLeft || !bottomRight) {
		throw new Error("区域截图需要提供左上角和右下角坐标")
	}

	// 解析坐标
	const [x1, y1] = topLeft.split(",").map(Number)
	const [x2, y2] = bottomRight.split(",").map(Number)

	if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) {
		throw new Error(`无效的坐标格式: topLeft=${topLeft}, bottomRight=${bottomRight}`)
	}

	console.log(`[BG_WS_SS] 正在捕获区域截图 (${x1},${y1}) - (${x2},${y2})`)

	// 检查调试器是否已附加
	if (!isDebuggerAttached(activeTabId)) {
		throw new Error(`无法捕获区域截图: 调试器未附加到标签页 ${activeTabId}`)
	}

	// 直接使用CDP方法捕获区域截图，失败时直接抛出错误
	const areaScreenshot = await captureAreaScreenshotWithCDP(
		activeTabId,
		Math.min(x1, x2),
		Math.min(y1, y2),
		Math.abs(x2 - x1),
		Math.abs(y2 - y1),
	)

	if (!areaScreenshot) {
		throw new Error("CDP区域截图失败: 未返回有效的截图数据")
	}

	return areaScreenshot
}

/**
 * 使用Chrome调试协议捕获指定区域的截图
 * @param {number} tabId - 标签页ID
 * @param {number} x - 区域左上角X坐标
 * @param {number} y - 区域左上角Y坐标
 * @param {number} width - 区域宽度
 * @param {number} height - 区域高度
 * @returns {Promise<string>} 区域截图的Data URL
 */
async function captureAreaScreenshotWithCDP(tabId, x, y, width, height) {
	// 验证参数
	if (!tabId) {
		throw new Error(`无效的标签页ID: ${tabId}`)
	}

	if (width <= 0 || height <= 0) {
		throw new Error(`无效的区域尺寸: ${width}x${height}`)
	}

	// 检查调试器是否附加
	if (!debugTarget || debugTarget.tabId !== tabId) {
		throw new Error(`调试器未正确附加到标签页 ${tabId}`)
	}

	console.log(`[BG_WS_SS_CDP] 使用CDP捕获区域截图 (${x},${y},${width},${height})`)

	// 执行CDP命令
	try {
		// 设置裁剪区域
		const clip = {
			x: x,
			y: y,
			width: width,
			height: height,
			scale: 1,
		}

		// 执行截图
		const screenshotResult = await chrome.debugger.sendCommand({ tabId: tabId }, "Page.captureScreenshot", {
			format: "jpeg",
			quality: 100,
			clip: clip,
			fromSurface: true,
		})

		if (!screenshotResult || !screenshotResult.data) {
			throw new Error("CDP命令未返回有效的截图数据")
		}

		console.log(`[BG_WS_SS_CDP] 成功捕获区域截图，数据长度: ${screenshotResult.data.length}`)
		return "data:image/jpeg;base64," + screenshotResult.data
	} catch (error) {
		console.error(`[BG_WS_SS_CDP] 区域截图捕获失败: ${error.message}`)
		throw error // 直接抛出错误，不提供备选方案
	}
}

/**
 * 捕获当前活动标签页的截图，无需传入tabId
 * @returns {Promise<string>} 截图的Data URL
 */
export async function captureCurrentTabScreenshot() {
	// 获取当前活动标签页ID
	const activeTabId = getActiveTabId()
	if (!activeTabId) {
		console.error("[BG_WS_SS_CDP] 无活动标签页，无法捕获截图")
		return null
	}

	return captureVisibleTabPromise(activeTabId)
}
