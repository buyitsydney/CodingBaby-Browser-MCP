/**
 * 全局调试目标对象
 * @type {Object|null}
 */
export let debugTarget = null

/**
 * 初始化调试器相关的事件监听器
 */
export function initDebuggerListeners() {
	// 监听调试器分离事件
	chrome.debugger.onDetach.addListener(handleDebuggerDetach)
}

/**
 * 处理调试器分离事件
 * @param {Object} source - 分离源对象 {tabId}
 * @param {string} reason - 分离原因
 */
function handleDebuggerDetach(source, reason) {
	console.log(`[BG_WS] Debugger detached from tab ${source.tabId}. Reason: ${reason}`)
	if (debugTarget && debugTarget.tabId === source.tabId) {
		debugTarget = null // 清除追踪的目标
	}
}

/**
 * 验证调试器是否已成功附加到指定标签页
 * @param {number} tabId - 标签页ID
 * @returns {Promise<boolean>} - 是否已附加调试器
 */
export async function isDebuggerAttached(tabId) {
	try {
		// 获取当前附加的调试目标
		const targets = await chrome.debugger.getTargets()

		// 检查是否有目标匹配当前tabId并且已附加
		const attachedToTab = targets.some((target) => target.tabId === tabId && target.attached === true)

		console.log(`[BG_WS_DEBUGGER] Debugger attachment status for tab ${tabId}: ${attachedToTab}`)

		return attachedToTab
	} catch (error) {
		console.error(`[BG_WS_DEBUGGER] Error checking debugger attachment: ${error.message}`)
		return false
	}
}

/**
 * 安全地清除目标标签页之前的调试器
 * @param {number} tabId - 标签页ID
 */
async function safelyDetachPreviousDebugger(tabId) {
	// 如果当前没有调试目标，不需要分离
	if (!debugTarget) {
		return
	}

	// 如果当前调试目标与新目标相同，不需要分离
	if (debugTarget.tabId === tabId) {
		return
	}

	// 检查旧调试目标是否真的附加了调试器
	const isOldTargetAttached = await isDebuggerAttached(debugTarget.tabId)

	if (isOldTargetAttached) {
		try {
			// 首先尝试清除当前覆盖
			await chrome.debugger.sendCommand(debugTarget, "Emulation.clearDeviceMetricsOverride")
			console.log(`[BG_WS_EARLY_ATTACH] Successfully cleared override for previous target ${debugTarget.tabId}.`)
		} catch (error) {
			console.warn(
				`[BG_WS_EARLY_ATTACH] Failed to clear override for previous target ${debugTarget.tabId}: ${error.message}`,
			)
			// 继续尝试分离
		}

		try {
			// 分离旧调试器
			await chrome.debugger.detach(debugTarget)
			console.log(`[BG_WS_EARLY_ATTACH] Successfully detached from previous target ${debugTarget.tabId}.`)
		} catch (error) {
			console.warn(`[BG_WS_EARLY_ATTACH] Failed to detach previous debug target ${debugTarget.tabId}: ${error.message}`)
			// 即使分离失败也继续
		}
	} else {
		console.log(
			`[BG_WS_EARLY_ATTACH] Previous debug target ${debugTarget.tabId} is not actually attached, no need to detach.`,
		)
	}

	// 不管是否成功分离，都清除全局引用
	debugTarget = null
}

/**
 * 附加调试器到标签页
 * @param {number} tabId - 标签页ID
 * @returns {Promise<boolean>} 是否成功附加
 */
export async function attachDebugger(tabId) {
	if (!tabId) {
		console.error("[BG_WS_EARLY_ATTACH] Invalid tab ID provided for attachDebugger:", tabId)
		return false
	}

	try {
		// 首先检查调试器是否已经附加到目标标签页
		const alreadyAttached = await isDebuggerAttached(tabId)

		if (alreadyAttached) {
			console.log(`[BG_WS_EARLY_ATTACH] Debugger already attached to tab ${tabId}.`)

			// 确保debugTarget与实际状态同步
			if (!debugTarget || debugTarget.tabId !== tabId) {
				debugTarget = { tabId }
				console.log(`[BG_WS_EARLY_ATTACH] Updated debugTarget to reflect existing attachment to tab ${tabId}.`)
			}

			return true
		}

		// 安全地分离之前的调试器
		await safelyDetachPreviousDebugger(tabId)

		// 附加新的调试器
		await chrome.debugger.attach({ tabId }, "1.3")
		console.log(`[BG_WS_EARLY_ATTACH] Successfully attached debugger to tab ${tabId}.`)

		// 启用必要的域
		await chrome.debugger.sendCommand({ tabId }, "Page.enable")
		await chrome.debugger.sendCommand({ tabId }, "Runtime.enable")
		await chrome.debugger.sendCommand({ tabId }, "DOM.enable")

		// 更新全局调试目标
		debugTarget = { tabId }

		// 验证调试器确实附加成功
		const verifyAttached = await isDebuggerAttached(tabId)
		if (!verifyAttached) {
			console.error(
				`[BG_WS_EARLY_ATTACH] Verification failed: Debugger appears not attached to tab ${tabId} despite successful commands.`,
			)
			return false
		}

		return true
	} catch (error) {
		console.error(`[BG_WS_EARLY_ATTACH] Error attaching debugger to tab ${tabId}:`, error)

		// 清除状态
		if (debugTarget && debugTarget.tabId === tabId) {
			debugTarget = null
		}

		return false
	}
}

/**
 * 如果需要，分离调试器
 */
export async function detachDebuggerIfNeeded() {
	if (debugTarget) {
		console.log(`[BG_WS] Detaching debugger from tab ${debugTarget.tabId} due to WebSocket disconnect/close.`)
		try {
			// 在分离前清除覆盖
			try {
				await chrome.debugger.sendCommand(debugTarget, "Emulation.clearDeviceMetricsOverride", {})
				console.log(`[BG_WS] Cleared device metrics override for tab ${debugTarget.tabId} before detaching.`)
			} catch (clearError) {
				// 记录错误但继续分离
				console.warn(
					`[BG_WS] Failed to clear device metrics override for tab ${debugTarget.tabId} before detaching:`,
					clearError,
				)
			}

			await chrome.debugger.detach(debugTarget)
		} catch (error) {
			console.error(`[BG_WS] Error detaching debugger:`, error)
		}

		debugTarget = null
	}
}
