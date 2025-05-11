/**
 * CodingBaby 浏览器插件可视化初始化脚本
 * 此脚本作为内容脚本注入，负责准备页面以支持可视化效果
 */

console.log("[VIZ Content Script] 可视化初始化脚本已加载")

// 标记初始化状态
let isInitialized = false

// 当页面首次加载完成时初始化
if (document.readyState === "complete") {
	initVisualization()
} else {
	window.addEventListener("load", () => {
		initVisualization()
	})
}

// 处理来自background.js的初始化消息
document.addEventListener("codingBabyVisualizationReady", initVisualization)

// 监听来自background.js的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.action === "initVisualization") {
		const result = initVisualization()
		sendResponse({ success: result })
		return true // 保持消息通道开放以支持异步响应
	}
})

/**
 * 初始化可视化组件
 * @returns {boolean} 初始化是否成功
 */
function initVisualization() {
	// 如果已经初始化过，直接返回成功
	if (isInitialized) {
		console.log("[VIZ Content Script] 可视化组件已初始化，跳过重复初始化")
		return true
	}

	// 如果页面还没有body，等待DOM加载完成
	if (!document.body) {
		console.log("[VIZ Content Script] 页面DOM未就绪，等待加载完成后初始化")
		document.addEventListener("DOMContentLoaded", () => {
			setTimeout(initVisualization, 100) // 短暂延迟，确保DOM已完全加载
		})
		return false
	}

	console.log("[VIZ Content Script] 正在初始化鼠标可视化组件")

	try {
		// 清理可能存在的元素
		cleanupExisting()

		// 标记为已初始化 - 我们只需要标记已初始化，实际元素会在需要时创建
		isInitialized = true

		// 发送就绪消息到后台脚本
		notifyVisualizationReady()

		console.log("[VIZ Content Script] 可视化组件初始化标记完成")
		return true
	} catch (error) {
		console.error("[VIZ Content Script] 初始化可视化组件时出错:", error)
		return false
	}
}

/**
 * 通知后台脚本可视化组件已准备就绪
 */
function notifyVisualizationReady() {
	try {
		chrome.runtime.sendMessage(
			{
				type: "visualization_ready",
				url: window.location.href,
			},
			(response) => {
				if (chrome.runtime.lastError) {
					console.warn("[VIZ Content Script] 发送就绪通知失败:", chrome.runtime.lastError.message)
				} else if (response && response.received) {
					console.log("[VIZ Content Script] 后台脚本已接收到就绪通知")
				}
			},
		)
	} catch (error) {
		console.error("[VIZ Content Script] 发送就绪通知时出错:", error)
	}
}

/**
 * 清理可能存在的元素
 */
function cleanupExisting() {
	// 移除现有容器
	const existingContainer = document.getElementById("coding-baby-mouse-container")
	if (existingContainer) {
		existingContainer.remove()
	}

	// 移除现有样式
	const existingStyle = document.getElementById("coding-baby-viz-styles")
	if (existingStyle) {
		existingStyle.remove()
	}
}
