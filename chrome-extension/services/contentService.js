import { openedTabIds, getActiveTabId } from "./tabService.js"

/**
 * 在标签页中执行脚本
 * @param {Function} func - 要执行的函数
 * @param {Array} args - 函数参数
 * @param {number} targetTabId - 目标标签页ID
 * @returns {Promise<any>} 脚本执行结果
 */
export async function executeScriptInTab(func, args = [], targetTabId) {
	// 不再查询活动标签页，使用targetTabId
	if (!targetTabId) {
		throw new Error("No targetTabId provided for script execution")
	}

	if (!openedTabIds.has(targetTabId)) {
		// 可选：仅允许在扩展打开的标签页中执行脚本？
		console.warn(`[BG_WS] Attempting to execute script in non-tracked target tab ${targetTabId}`)
	}

	try {
		console.log(`[BG_WS] Executing script in target tab ${targetTabId}`)
		const results = await chrome.scripting.executeScript({
			target: { tabId: targetTabId },
			func: func,
			args: args,
			world: "MAIN", // 如果需要在页面上下文中执行，尽管ISOLATED更安全
		})

		// 检查结果，假设简单执行
		if (results && results.length > 0) {
			console.log(`[BG_WS] Script execution result in tab ${targetTabId}:`, results[0].result)
			return results[0].result
		} else {
			console.log(`[BG_WS] Script execution in tab ${targetTabId} returned no result.`)
			return undefined
		}
	} catch (error) {
		console.error(`[BG_WS] Error executing script in tab ${targetTabId}:`, error)
		throw error // 重新抛出，由调用者捕获
	}
}

/**
 * 获取页面的完整HTML
 * @returns {Promise<string>} HTML内容
 */
export async function getFullHtml() {
	// 获取当前活动标签页ID
	const activeTabId = getActiveTabId()
	if (!activeTabId) {
		throw new Error("无可用的标签页获取HTML内容")
	}

	try {
		const result = await chrome.scripting.executeScript({
			target: { tabId: activeTabId },
			func: () => {
				return document.documentElement.outerHTML
			},
		})

		if (!result || !result[0] || result[0].result === undefined) {
			throw new Error("无法获取HTML内容")
		}

		return result[0].result
	} catch (error) {
		console.error("[BG_WS] 获取页面HTML时出错:", error)
		throw error
	}
}

/**
 * 获取当前视口大小
 * @returns {Promise<Object>} 视口大小 {width, height}
 */
export async function getViewportSize() {
	// 获取当前活动标签页ID
	const activeTabId = getActiveTabId()
	if (!activeTabId) {
		throw new Error("无可用的标签页获取视口大小")
	}

	try {
		const result = await chrome.scripting.executeScript({
			target: { tabId: activeTabId },
			func: () => {
				return {
					width: window.innerWidth,
					height: window.innerHeight,
					devicePixelRatio: window.devicePixelRatio || 1,
				}
			},
		})

		if (!result || !result[0] || !result[0].result) {
			throw new Error("无法获取视口大小")
		}

		return result[0].result
	} catch (error) {
		console.error("[BG_WS] 获取视口大小时出错:", error)
		throw error
	}
}
