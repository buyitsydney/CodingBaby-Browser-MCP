/**
 * 等待HTML内容稳定（不再变化）
 * @param {number} tabId - 标签页ID
 * @param {number} timeout - 超时时间（毫秒）
 * @param {number} checkInterval - 检查间隔（毫秒）
 * @param {number} stableIterations - 需要连续相同才算稳定的次数
 * @returns {Promise<void>}
 */
export async function waitTillHTMLStable(tabId, timeout = 5000, checkInterval = 500, stableIterations = 3) {
	console.log(`[BG_WS_STABLE] Starting stability check for tab ${tabId} (timeout: ${timeout}ms)`)
	let lastHTMLSize = 0
	let currentHTMLSize = 0
	let stableCount = 0
	let errorCount = 0 // 记录连续错误次数
	const maxErrors = 3 // 最大允许的连续错误次数
	const startTime = Date.now()

	const getHtmlSize = async () => {
		try {
			// 首先检查标签页是否仍然存在
			try {
				const tab = await chrome.tabs.get(tabId)
				// 检查标签页是否仍在加载中
				if (tab.status === "loading") {
					console.warn(`[BG_WS_STABLE] Tab ${tabId} still loading, waiting...`)
					return 0 // 继续等待
				}
			} catch (e) {
				console.warn(`[BG_WS_STABLE] Tab ${tabId} does not exist anymore during stability check.`)
				return -1 // 标签页不存在
			}

			// 等待一个非常短的时间，让页面准备就绪
			await new Promise((resolve) => setTimeout(resolve, 50))

			// 尝试执行脚本获取HTML大小
			const results = await chrome.scripting.executeScript({
				target: { tabId: tabId },
				func: () => document.documentElement.outerHTML.length,
				world: "MAIN", // 访问主世界DOM
			})
			if (results && results.length > 0 && results[0].result !== null) {
				errorCount = 0 // 成功后重置错误计数
				return results[0].result
			} else {
				console.warn(`[BG_WS_STABLE] Failed to get HTML size for tab ${tabId}, assuming 0.`)
				return 0 // 如果无法确定大小，则返回0
			}
		} catch (error) {
			errorCount++ // 增加错误计数
			// 处理标签页可能已关闭或无法访问的情况
			if (error.message.includes("No tab with id") || error.message.includes("Cannot access contents of url")) {
				console.warn(`[BG_WS_STABLE] Tab ${tabId} inaccessible or closed during stability check.`)
				if (errorCount >= maxErrors) {
					return -1 // 仅在连续多次错误后才认为标签页已消失
				} else {
					return 0 // 暂时性问题，返回0继续检查
				}
			} else if (error.message.includes("Script execution failed") || error.message.includes("execution context")) {
				// 页面正在加载中，执行脚本暂时失败
				console.warn(`[BG_WS_STABLE] Tab ${tabId} not ready for script execution, waiting...`)
				return 0 // 继续等待
			} else {
				console.error(`[BG_WS_STABLE] Error getting HTML size for tab ${tabId}:`, error)
				if (errorCount >= maxErrors) {
					throw error // 仅在连续多次错误后才抛出
				}
				return 0 // 继续等待
			}
		}
	}

	while (Date.now() - startTime < timeout) {
		try {
			currentHTMLSize = await getHtmlSize()

			if (currentHTMLSize === -1) {
				console.log(`[BG_WS_STABLE] Tab ${tabId} consistently inaccessible, stopping stability check.`)
				return // 如果标签页已消失，停止检查
			}

			if (lastHTMLSize !== 0 && currentHTMLSize === lastHTMLSize) {
				stableCount++
			} else {
				stableCount = 0 // 如果大小变化，重置计数器
			}

			if (stableCount >= stableIterations) {
				console.log(`[BG_WS_STABLE] Tab ${tabId} considered stable after ${Date.now() - startTime}ms.`)
				return // 页面稳定
			}

			lastHTMLSize = currentHTMLSize
			await new Promise((resolve) => setTimeout(resolve, checkInterval))
		} catch (error) {
			// 处理循环中的错误，但不立即退出
			console.error(`[BG_WS_STABLE] Error during stability check loop for tab ${tabId}:`, error)
			await new Promise((resolve) => setTimeout(resolve, checkInterval))
			// 仅在临近超时时才退出
			if (Date.now() - startTime > timeout - checkInterval) {
				break
			}
		}
	}

	console.log(`[BG_WS_STABLE] Tab ${tabId} stability check timed out after ${timeout}ms. Proceeding anyway.`)
}
