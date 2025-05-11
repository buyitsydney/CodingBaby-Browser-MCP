/**
 * 浏览器操作录制器
 * 负责监听和记录用户在浏览器中的操作
 */
class BrowserRecorder {
	constructor() {
		this.isRecording = false
		this.setupListeners()
		console.log("Browser Recorder initialized")
	}

	setupListeners() {
		// 点击事件监听
		document.addEventListener(
			"click",
			(e) => {
				if (!this.isRecording) return

				this.recordAction("click", {
					coordinate: `${e.clientX},${e.clientY}`,
					targetDescription: this.getElementDescription(e.target),
				})
			},
			true,
		)

		// 滚动事件监听（节流处理）
		let scrollTimeout
		document.addEventListener(
			"scroll",
			(e) => {
				if (!this.isRecording) return

				clearTimeout(scrollTimeout)
				scrollTimeout = setTimeout(() => {
					const direction = this.getScrollDirection()
					if (direction) {
						this.recordAction(`scroll_${direction}`, {
							selector: this.getScrollContainerSelector(e.target),
						})
					}
				}, 500)
			},
			true,
		)

		// 键盘输入监听
		document.addEventListener(
			"keydown",
			(e) => {
				if (!this.isRecording) return

				// 处理特殊按键
				if (this.isSpecialKey(e.key)) {
					this.recordAction("press_key", { key: e.key })
					return
				}

				// 处理组合键
				if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) {
					const combo = this.getKeyCombination(e)
					this.recordAction("press_combination", { combination: combo })
					return
				}
			},
			true,
		)

		// 输入事件监听（针对文本输入）
		document.addEventListener(
			"input",
			(e) => {
				if (!this.isRecording || !e.target.value) return

				this.recordAction("type", {
					text: e.target.value,
					targetDescription: this.getElementDescription(e.target),
				})
			},
			true,
		)
	}

	recordAction(actionType, params) {
		chrome.runtime.sendMessage({
			type: "RECORD_ACTION",
			actionType,
			params,
			timestamp: Date.now(),
		})
	}

	getElementDescription(element) {
		// 智能生成元素描述
		let description = ""

		// 尝试使用可访问性属性
		if (element.ariaLabel) {
			description += `"${element.ariaLabel}" `
		}

		// 使用文本内容
		if (element.textContent && element.textContent.trim()) {
			description += `"${element.textContent.trim().substring(0, 50)}" `
		}

		// 使用类型和属性
		description += `${element.tagName.toLowerCase()} `
		if (element.id) description += `#${element.id} `
		if (element.className) description += `.${element.className.replace(/\s+/g, ".")} `

		return description.trim()
	}

	getScrollDirection() {
		// 根据滚动位置变化判断方向
		// 简化实现，实际应比较前后滚动位置
		return "down"
	}

	getScrollContainerSelector(element) {
		// 识别滚动容器的CSS选择器
		// 优先查找Grafana特定滚动容器
		const grafanaScroller = document.querySelector(".scrollbar-view")
		if (grafanaScroller) {
			return ".scrollbar-view"
		}

		// 其他情况返回默认选择器
		return element.id ? `#${element.id}` : "body"
	}

	isSpecialKey(key) {
		const specialKeys = ["Enter", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]
		return specialKeys.includes(key)
	}

	getKeyCombination(event) {
		let combo = []
		if (event.ctrlKey) combo.push("Control")
		if (event.altKey) combo.push("Alt")
		if (event.shiftKey) combo.push("Shift")
		if (event.metaKey) combo.push("Meta")
		combo.push(event.key)
		return combo.join("+")
	}

	start() {
		this.isRecording = true
		console.log("Recording started")
	}

	stop() {
		this.isRecording = false
		console.log("Recording stopped")
	}
}

// 初始化记录器
const recorder = new BrowserRecorder()

// 监听来自background的命令
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.command === "START_RECORDING") {
		recorder.start()
		sendResponse({ success: true })
	} else if (message.command === "STOP_RECORDING") {
		recorder.stop()
		sendResponse({ success: true })
	}
	return true
})
