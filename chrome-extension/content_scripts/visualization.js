// 通知后台脚本内容脚本已加载
// 减少加载日志
// console.log("[VIZ Content] 可视化内容脚本已加载")

// 跟踪录制状态
let isRecording = false
let recordingActions = []
// 跟踪是否已发送就绪消息，避免重复发送
let hasNotifiedReady = false

// 监听来自后台脚本的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	// 减少每次消息日志
	// console.log("[VIZ Content] 收到消息:", message)

	// 处理就绪状态检查
	if (message.command === "CHECK_VISUALIZATION_READY") {
		// 减少就绪检查日志
		// console.log("[VIZ Content] 响应就绪状态检查")
		sendResponse({ ready: true })

		// 通知后台脚本内容脚本已准备就绪（仅当未发送过时）
		if (!hasNotifiedReady) {
			hasNotifiedReady = true
			chrome.runtime
				.sendMessage({ type: "visualization_ready" })
				.catch((error) => console.error("[VIZ Content] 发送就绪消息失败:", error))
		}
		return true
	}

	// 处理录制启动
	if (message.command === "START_RECORDING") {
		// 避免重复启动录制
		if (isRecording) {
			// 减少重复录制日志
			// console.log("[VIZ Content] 已经在录制中，忽略重复的开始录制命令")
			sendResponse({ success: true, message: "已在录制中" })
			return true
		}

		// 保留开始录制日志
		console.log("[VIZ Content] 开始录制浏览器操作")
		isRecording = true
		recordingActions = []
		setupRecordingListeners()

		// 记录初始页面状态
		recordAction("pageload", {
			url: window.location.href,
			title: document.title,
			timestamp: Date.now(),
		})

		sendResponse({ success: true, message: "录制已开始" })
		return true
	}

	// 处理录制停止
	if (message.command === "STOP_RECORDING") {
		// 保留停止录制日志
		console.log("[VIZ Content] 停止录制浏览器操作")

		if (!isRecording) {
			console.log("[VIZ Content] 未在录制状态，忽略停止命令")
			sendResponse({ success: false, message: "未在录制状态" })
			return true
		}

		isRecording = false
		removeRecordingListeners()
		sendResponse({ success: true, message: "录制已停止" })
		return true
	}

	return false
})

// 记录用户操作的函数
function recordAction(actionType, params = {}) {
	if (!isRecording) return

	try {
		// 减少每次操作的日志
		// console.log(`[VIZ Content] 记录操作: ${actionType}`, params)

		// 创建操作记录
		const action = {
			actionType,
			params,
			timestamp: Date.now(),
			url: window.location.href,
			title: document.title,
		}

		// 发送到后台脚本
		chrome.runtime
			.sendMessage({
				type: "RECORD_ACTION",
				...action,
			})
			.catch((error) => {
				console.error("[VIZ Content] 发送操作记录失败:", error)
			})
	} catch (error) {
		console.error("[VIZ Content] 记录操作时出错:", error)
	}
}

// 事件处理器
const eventHandlers = {
	click: (event) => {
		if (!isRecording) return

		try {
			// 获取点击坐标
			const x = event.clientX
			const y = event.clientY

			recordAction("click", {
				x,
				y,
				target: {
					tagName: event.target.tagName,
					id: event.target.id,
					className: event.target.className,
					innerText: event.target.innerText?.substring(0, 50), // 限制长度
				},
			})
		} catch (error) {
			console.error("[VIZ Content] 处理点击事件时出错:", error)
		}
	},

	keydown: (event) => {
		if (!isRecording) return
		try {
			if (event.key === "Tab" || event.key === "Shift" || event.key === "Control" || event.key === "Alt") return

			recordAction("keypress", {
				key: event.key,
				isCombo: event.ctrlKey || event.altKey || event.shiftKey || event.metaKey,
				modifiers: {
					ctrl: event.ctrlKey,
					alt: event.altKey,
					shift: event.shiftKey,
					meta: event.metaKey,
				},
			})
		} catch (error) {
			console.error("[VIZ Content] 处理按键事件时出错:", error)
		}
	},

	input: (event) => {
		if (!isRecording) return
		try {
			if (!event.target || !event.target.value) return

			// 节流，避免过多记录
			if (event.target._lastRecordTime && Date.now() - event.target._lastRecordTime < 500) return
			event.target._lastRecordTime = Date.now()

			recordAction("input", {
				value: event.target.value,
				target: {
					tagName: event.target.tagName,
					id: event.target.id,
					className: event.target.className,
					type: event.target.type,
				},
			})
		} catch (error) {
			console.error("[VIZ Content] 处理输入事件时出错:", error)
		}
	},

	scroll: (event) => {
		if (!isRecording) return
		try {
			// 节流，避免过多记录
			if (window._lastScrollTime && Date.now() - window._lastScrollTime < 500) return
			window._lastScrollTime = Date.now()

			recordAction("scroll", {
				scrollX: window.scrollX,
				scrollY: window.scrollY,
			})
		} catch (error) {
			console.error("[VIZ Content] 处理滚动事件时出错:", error)
		}
	},
}

// 设置录制事件监听器
function setupRecordingListeners() {
	console.log("[VIZ Content] 设置录制事件监听器")
	try {
		document.addEventListener("click", eventHandlers.click, true)
		document.addEventListener("keydown", eventHandlers.keydown, true)
		document.addEventListener("input", eventHandlers.input, true)
		window.addEventListener("scroll", eventHandlers.scroll, true)
	} catch (error) {
		console.error("[VIZ Content] 设置事件监听器时出错:", error)
	}
}

// 移除录制事件监听器
function removeRecordingListeners() {
	console.log("[VIZ Content] 移除录制事件监听器")
	try {
		document.removeEventListener("click", eventHandlers.click, true)
		document.removeEventListener("keydown", eventHandlers.keydown, true)
		document.removeEventListener("input", eventHandlers.input, true)
		window.removeEventListener("scroll", eventHandlers.scroll, true)
	} catch (error) {
		console.error("[VIZ Content] 移除事件监听器时出错:", error)
	}
}

// 当页面加载完成时，通知后台脚本（仅当未发送过时）
window.addEventListener("load", () => {
	// 减少加载日志
	// console.log("[VIZ Content] 页面加载完成")
	if (!hasNotifiedReady) {
		// 减少就绪消息日志
		// console.log("[VIZ Content] 发送页面加载完成时的就绪消息")
		hasNotifiedReady = true
		chrome.runtime
			.sendMessage({ type: "visualization_ready" })
			.catch((error) => console.error("[VIZ Content] 发送就绪消息失败:", error))
	}
})

// 立即通知后台脚本内容脚本已加载（避免加载后等待load事件导致的延迟）（仅当未发送过时）
if (!hasNotifiedReady) {
	// 减少初始就绪消息日志
	// console.log("[VIZ Content] 发送初始就绪消息")
	hasNotifiedReady = true
	chrome.runtime
		.sendMessage({ type: "visualization_ready" })
		.catch((error) => console.error("[VIZ Content] 发送初始就绪消息失败:", error))
}
