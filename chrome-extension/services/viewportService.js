// 存储从VSCode接收的viewport配置
export let viewportConfig = {
	width: 1080, // 默认值修改为1080
	height: 800, // 默认值修改为800
}

/**
 * 更新视口配置
 * @param {Object} config - 视口配置对象 {width, height}
 */
export function updateViewportConfig(config) {
	viewportConfig = {
		width: config.width || 1080, // 使用与config.js一致的默认值
		height: config.height || 800, // 使用与config.js一致的默认值
	}
	console.log("[BG_WS] Updated viewport configuration to:", viewportConfig)
}

/**
 * 应用视口配置到目标
 * @param {Object} target - 调试目标 {tabId}
 * @returns {Promise<boolean>} - 是否成功应用配置
 */
export async function applyViewportConfig(target) {
	if (!target || !target.tabId) {
		console.error("[BG_WS_VIEWPORT] Invalid target for viewport application:", target)
		return false
	}

	// 检查目标标签页是否存在
	try {
		await chrome.tabs.get(target.tabId)
	} catch (error) {
		console.error(`[BG_WS_VIEWPORT] Tab ${target.tabId} does not exist for viewport configuration: ${error.message}`)
		return false
	}

	// 验证调试器是否真的附加到目标标签页
	try {
		const targets = await chrome.debugger.getTargets()
		const targetAttached = targets.some((t) => t.tabId === target.tabId && t.attached)

		if (!targetAttached) {
			console.error(`[BG_WS_VIEWPORT] Debugger not attached to tab ${target.tabId} for viewport configuration`)
			return false
		}
	} catch (error) {
		console.error(`[BG_WS_VIEWPORT] Error checking debugger targets: ${error.message}`)
		return false
	}

	// 确保视口配置存在
	if (!viewportConfig) {
		console.error("[BG_WS_VIEWPORT] No viewport configuration available. Call updateViewportConfig first.")
		return false
	}

	try {
		// 设置设备指标覆盖 - 如果成功执行，就认为设置成功
		await chrome.debugger.sendCommand(target, "Emulation.setDeviceMetricsOverride", {
			width: viewportConfig.width,
			height: viewportConfig.height,
			deviceScaleFactor: 1,
			mobile: false,
		})

		// 命令执行成功，记录日志并返回成功
		console.log(`[BG_WS_VIEWPORT] Viewport applied to tab ${target.tabId}: ${viewportConfig.width}x${viewportConfig.height}`)
		console.log(
			`[BG_WS] Applied viewport configuration (${viewportConfig.width}x${viewportConfig.height}) to tab ${target.tabId}`,
		)
		return true
	} catch (error) {
		// 命令执行失败，记录错误并返回失败
		console.error(`[BG_WS_VIEWPORT] Failed to apply viewport: ${error.message}`)
		return false
	}
}
