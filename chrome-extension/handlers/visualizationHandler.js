/**
 * 可视化处理程序
 * 处理鼠标指针和动画的可视化请求
 */

import { getActiveTabId } from "../services/tabService.js"

// 全局存储当前可视化状态的标签页ID
let activeVisualizationTabId = null
// 存储已初始化的标签页ID集合
const initializedTabs = new Set()
// 存储每个标签页的最后鼠标位置
const lastMousePositions = new Map()

/**
 * 确保标签页的可视化功能已初始化
 * @param {number} tabId 标签页ID
 * @returns {Promise<boolean>} 是否成功初始化
 */
export async function ensureVisualizationInitialized(tabId) {
	try {
		// 如果标签页已初始化，直接返回成功
		if (initializedTabs.has(tabId)) {
			return true
		}

		// 获取标签页信息
		const tab = await chrome.tabs.get(tabId)

		// 跳过不支持的URL
		if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
			return false
		}

		// 注入内容脚本
		try {
			await chrome.scripting.executeScript({
				target: { tabId: tabId },
				files: ["content_scripts/visualization.js"],
			})

			// 给内容脚本一些时间初始化
			await new Promise((resolve) => setTimeout(resolve, 500))

			// 确认内容脚本已就绪
			try {
				const response = await chrome.tabs.sendMessage(tabId, { command: "CHECK_VISUALIZATION_READY" })
				if (response && response.ready) {
					markTabInitialized(tabId)
					return true
				} else {
					console.warn(`[VIZ Handler] 标签页 ${tabId} 可视化组件未确认就绪`)
					return false
				}
			} catch (checkError) {
				console.warn(`[VIZ Handler] 检查标签页 ${tabId} 可视化组件就绪状态时出错`)
				console.log(`[VIZ Handler] 尝试使用内联脚本方式初始化`)

				// 尝试直接执行代码方式注入
				try {
					await chrome.scripting.executeScript({
						target: { tabId: tabId },
						func: () => {
							chrome.runtime
								.sendMessage({ type: "visualization_ready" })
								.catch((err) => console.error("[VIZ Content] 发送就绪消息失败:", err))

							if (!window._vizListenerSet) {
								window._vizListenerSet = true
								chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
									if (message.command === "CHECK_VISUALIZATION_READY") {
										sendResponse({ ready: true })
										return true
									}
									return false
								})
							}
						},
					})

					await new Promise((resolve) => setTimeout(resolve, 500))

					// 再次检查就绪状态
					const retryResponse = await chrome.tabs
						.sendMessage(tabId, { command: "CHECK_VISUALIZATION_READY" })
						.catch((e) => null)

					if (retryResponse && retryResponse.ready) {
						markTabInitialized(tabId)
						return true
					} else {
						console.warn(`[VIZ Handler] 初始化标签页 ${tabId} 失败，两种方法均未成功`)
						return false
					}
				} catch (inlineError) {
					console.error(`[VIZ Handler] 内联脚本初始化失败`)
					return false
				}
			}
		} catch (injectError) {
			console.error(`[VIZ Handler] 向标签页 ${tabId} 注入内容脚本时出错`)
			return false
		}
	} catch (error) {
		console.error(`[VIZ Handler] 初始化标签页 ${tabId} 可视化功能时出错`)
		return false
	}
}

/**
 * 执行鼠标点击可视化
 * @param {number} tabId - 标签页ID
 * @param {number} x - 目标X坐标
 * @param {number} y - 目标Y坐标
 * @returns {Promise<boolean>} - 是否成功执行
 */
export async function executeMouseClick(tabId, x, y) {
	try {
		//console.log(`[VIZ Handler] 执行标签页 ${tabId} 的鼠标点击可视化 (${x},${y})`)

		// 获取上一次的鼠标位置（如果有）
		const lastPosition = lastMousePositions.get(tabId)
		const hasLastPosition = !!lastPosition

		// 提取出简单值，而不是传递复杂对象
		const lastX = hasLastPosition ? lastPosition.x : -1
		const lastY = hasLastPosition ? lastPosition.y : -1

		// 确保可视化组件已初始化
		const isInitialized = await ensureVisualizationInitialized(tabId)
		if (!isInitialized) {
			console.warn(`[VIZ Handler] 初始化可视化组件失败，将直接执行点击操作而不显示可视化效果`)
			return false
		}

		// 简化注入的脚本，使用更直接的DOM操作，确保性能和可靠性
		//console.log(`[VIZ Handler] 开始执行鼠标动画...`)
		const result = await chrome.scripting
			.executeScript({
				target: { tabId },
				func: (x, y, lastX, lastY, hasLastPosition) => {
					console.log(`[VIZ Script] 开始在页面内执行鼠标动画 (${x},${y})`)

					// 创建或获取鼠标指针元素
					let pointer = document.getElementById("coding-baby-mouse-pointer")
					let clickEffect = document.getElementById("coding-baby-mouse-click-effect")
					// 新增：创建鼠标坐标显示元素
					let coordLabel = document.getElementById("coding-baby-mouse-coord-label")

					// 如果元素不存在，可能是脚本加载时机问题，尝试创建
					if (!pointer || !clickEffect || !coordLabel) {
						console.log(`[VIZ Script] 找不到可视化元素，尝试创建`)

						// 如果容器不存在，创建容器
						let container = document.getElementById("coding-baby-mouse-container")
						if (!container) {
							container = document.createElement("div")
							container.id = "coding-baby-mouse-container"
							container.style.cssText = `
								position: fixed;
								top: 0;
								left: 0;
								width: 100%;
								height: 100%;
								pointer-events: none;
								z-index: 2147483647;
								overflow: hidden;
							`
							document.body.appendChild(container)
						}

						// 创建指针 - 更加醒目的样式
						if (!pointer) {
							pointer = document.createElement("div")
							pointer.id = "coding-baby-mouse-pointer"
							pointer.style.cssText = `
								position: absolute;
								width: 32px;
								height: 32px;
								background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M7,2l16,16l-8,1l4.5,9.5l-3,1.5l-4.5-9.5L7,24.5V2" fill="%23FF3355" stroke="%23FFFFFF" stroke-width="2"/></svg>');
								background-repeat: no-repeat;
								background-size: contain;
								transform-origin: 1px 1px;
								opacity: 1.0;
								filter: drop-shadow(0 0 4px rgba(0,0,0,0.5));
								display: block;
							`
							container.appendChild(pointer)
						} else {
							// 更新现有指针的样式
							pointer.style.width = "32px"
							pointer.style.height = "32px"
							pointer.style.backgroundImage = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M7,2l16,16l-8,1l4.5,9.5l-3,1.5l-4.5-9.5L7,24.5V2" fill="%23FF3355" stroke="%23FFFFFF" stroke-width="2"/></svg>')`
							pointer.style.opacity = "1.0"
							pointer.style.filter = "drop-shadow(0 0 4px rgba(0,0,0,0.5))"
						}

						// 创建点击效果 - 更加醒目
						if (!clickEffect) {
							clickEffect = document.createElement("div")
							clickEffect.id = "coding-baby-mouse-click-effect"
							clickEffect.style.cssText = `
								position: absolute;
								width: 48px;
								height: 48px;
								border-radius: 50%;
								background: radial-gradient(circle, rgba(255,51,85,0.8) 0%, rgba(255,51,85,0) 70%);
								transform: translate(-50%, -50%) scale(0);
								opacity: 0;
							`
							container.appendChild(clickEffect)
						} else {
							// 更新现有点击效果样式
							clickEffect.style.width = "48px"
							clickEffect.style.height = "48px"
							clickEffect.style.background =
								"radial-gradient(circle, rgba(255,51,85,0.8) 0%, rgba(255,51,85,0) 70%)"
						}

						// 新增：创建坐标显示标签
						if (!coordLabel) {
							coordLabel = document.createElement("div")
							coordLabel.id = "coding-baby-mouse-coord-label"
							coordLabel.style.cssText = `
								position: absolute;
								background-color: transparent;
								padding: 2px 4px;
								font-size: 12px;
								font-family: 'Arial', sans-serif;
								font-weight: bold;
								white-space: nowrap;
								z-index: 2147483647;
								transform: translate(15px, -20px);
								color: #FF3355;
								text-shadow: 
									-1px -1px 0 #FFFFFF,
									1px -1px 0 #FFFFFF,
									-1px 1px 0 #FFFFFF,
									1px 1px 0 #FFFFFF;
								pointer-events: none;
							`
							container.appendChild(coordLabel)
						}

						// 添加动画样式
						if (!document.getElementById("coding-baby-viz-styles")) {
							const styleElement = document.createElement("style")
							styleElement.id = "coding-baby-viz-styles"
							styleElement.textContent = `
								@keyframes coding-baby-click-effect {
									0% { transform: translate(-50%, -50%) scale(0); opacity: 0.9; }
									100% { transform: translate(-50%, -50%) scale(2); opacity: 0; }
								}
							`
							document.head.appendChild(styleElement)
						}
					}

					console.log(`[VIZ Script] 可视化元素已就绪，开始动画`)

					// 决定起始位置 - 使用上一次的位置或默认位置
					let startX, startY

					if (hasLastPosition && lastX > 0 && lastY > 0) {
						// 使用传入的上一次位置
						startX = lastX
						startY = lastY
						console.log(`[VIZ Script] 使用上一次点击位置作为起点: (${startX},${startY})`)
					} else {
						// 首次使用右上角作为默认位置
						startX = window.innerWidth - 100
						startY = 100
						console.log(`[VIZ Script] 使用默认右上角位置作为起点: (${startX},${startY})`)
					}

					// 立即显示鼠标在起始位置
					pointer.style.transform = `translate(${startX}px, ${startY}px)`
					pointer.style.display = "block"
					pointer.style.opacity = "1.0" // 完全不透明，更加明显

					// 显示起始坐标
					coordLabel.textContent = `X:${Math.round(startX)} Y:${Math.round(startY)}`
					coordLabel.style.left = `${startX}px`
					coordLabel.style.top = `${startY}px`
					coordLabel.style.display = "block"

					console.log(`[VIZ Script] 鼠标指针已显示在起始位置(${startX},${startY})`)

					// 计算简单的直线路径，加入轻微随机性使动画更自然
					return new Promise((resolve) => {
						// 获取当前时间作为动画起点
						const startTime = performance.now()
						// 降低持续时间使动画更快
						const duration = 400 // 从1000ms减少到400ms，让动画更快

						// 添加非常轻微的波动，让鼠标移动看起来更自然
						const addJitter = (value, magnitude) => {
							// 只有25%的几率添加抖动，并且幅度减小到原来的1/3
							if (Math.random() < 0.25) {
								return value + (Math.random() - 0.5) * magnitude * 2
							}
							return value // 大多数时候不添加抖动
						}

						console.log(`[VIZ Script] 开始动画，目标位置(${x},${y})，持续时间${duration}ms`)

						// 动画函数
						function animate(currentTime) {
							// 计算动画进度 (0-1)
							const elapsed = currentTime - startTime
							const progress = Math.min(elapsed / duration, 1)

							// 使用缓动函数，让动画更加自然
							const easeOutQuad = (t) => t * (2 - t)
							const easedProgress = easeOutQuad(progress)

							// 当前位置 = 起点 + 进度 * (终点 - 起点)
							let currentX = startX + (x - startX) * easedProgress
							let currentY = startY + (y - startY) * easedProgress

							// 如果动画未完成，添加非常轻微抖动
							if (progress < 1 && progress > 0.05) {
								currentX = addJitter(currentX, 1) // 降低到1像素幅度
								currentY = addJitter(currentY, 1)
							}

							// 更新指针位置
							pointer.style.transform = `translate(${currentX}px, ${currentY}px)`

							// 更新坐标标签
							coordLabel.textContent = `X:${Math.round(currentX)} Y:${Math.round(currentY)}`
							coordLabel.style.left = `${currentX}px`
							coordLabel.style.top = `${currentY}px`
							// 添加脉动效果
							const pulseScale = 1 + Math.sin(performance.now() / 200) * 0.05
							coordLabel.style.transform = `translate(15px, -20px) scale(${pulseScale})`

							// 如果动画未完成，继续
							if (progress < 1) {
								requestAnimationFrame(animate)
							} else {
								// 动画完成，显示点击效果
								console.log(`[VIZ Script] 动画完成，显示点击效果`)

								// 确保鼠标位于精确的目标位置
								pointer.style.transform = `translate(${x}px, ${y}px)`

								// 更新最终坐标显示
								coordLabel.textContent = `X:${Math.round(x)} Y:${Math.round(y)}`
								coordLabel.style.left = `${x}px`
								coordLabel.style.top = `${y}px`

								// 设置点击效果位置
								clickEffect.style.left = `${x}px`
								clickEffect.style.top = `${y}px`

								// 重置动画
								clickEffect.style.animation = "none"
								// 强制浏览器重新计算样式
								void clickEffect.offsetWidth

								// 应用点击动画
								clickEffect.style.animation = "coding-baby-click-effect 1s ease-out forwards"

								// 重要：点击完成后不要隐藏鼠标指针，让它保持可见
								// 之前的代码会在点击后立即隐藏指针，导致截图中看不到

								// 延迟通知动画完成，确保截图能捕获到点击效果
								setTimeout(() => {
									console.log(`[VIZ Script] 点击动画完成`)
									resolve(true)
								}, 500)
							}
						}

						// 开始动画
						requestAnimationFrame(animate)
					})
				},
				args: [x, y, lastX, lastY, hasLastPosition], // 使用简单值代替复杂对象
			})
			.catch((error) => {
				console.error(`[VIZ Handler] 执行可视化脚本失败: ${error.message}`)
				return [{ result: false }]
			})

		const success = result && result[0] && result[0].result
		//console.log(`[VIZ Handler] 标签页 ${tabId} 的点击可视化执行${success ? "完成" : "失败"}`)

		// 如果执行成功，更新最后的鼠标位置
		if (success) {
			lastMousePositions.set(tabId, { x, y })
			//console.log(`[VIZ Handler] 更新标签页 ${tabId} 的鼠标位置为 (${x},${y})`)
		}

		return success
	} catch (error) {
		console.error(`[VIZ Handler] 执行点击可视化时出错:`, error)
		return false
	}
}

/**
 * 清理指定标签页的可视化资源
 * @param {number} tabId - 标签页ID
 */
export async function cleanupVisualization(tabId) {
	try {
		// 标签页已关闭，从初始化列表中移除
		initializedTabs.delete(tabId)
		// 清除该标签页的最后鼠标位置记录
		lastMousePositions.delete(tabId)

		if (activeVisualizationTabId === tabId) {
			console.log(`[VIZ Handler] 清理标签页 ${tabId} 的可视化资源`)
			activeVisualizationTabId = null
		}

		console.log(`[VIZ Handler] 标签页 ${tabId} 已从初始化列表中移除`)
	} catch (error) {
		console.error(`[VIZ Handler] 清理可视化资源时出错:`, error)
	}
}

/**
 * 标记标签页为已初始化
 * @param {number} tabId - 标签页ID
 */
export function markTabInitialized(tabId) {
	if (initializedTabs.has(tabId)) {
		//console.log(`[VIZ Handler] 标签页 ${tabId} 已经在初始化列表中，跳过重复标记`)
		return false // 返回false表示这是重复初始化
	}

	initializedTabs.add(tabId)
	//console.log(`[VIZ Handler] 标签页 ${tabId} 已初始化，当前已初始化标签页数量: ${initializedTabs.size}`)
	return true // 返回true表示这是首次初始化
}

/**
 * 判断标签页是否已初始化
 * @param {number} tabId - 标签页ID
 * @returns {boolean} - 是否已初始化
 */
export function isTabInitialized(tabId) {
	return initializedTabs.has(tabId)
}

/**
 * 执行滚动可视化
 * @param {number} tabId - 标签页ID
 * @param {string} direction - 滚动方向：'up' 或 'down'
 * @param {string} selector - 可选的元素选择器
 * @returns {Promise<boolean>} - 是否成功执行
 */
export async function executeScrollVisualization(tabId, direction, selector = null) {
	try {
		//console.log(`[VIZ Handler] 执行标签页 ${tabId} 的滚动可视化 (方向: ${direction}, 选择器: ${selector})`)

		// 确保可视化组件已初始化
		const isInitialized = await ensureVisualizationInitialized(tabId)
		if (!isInitialized) {
			console.warn(`[VIZ Handler] 初始化可视化组件失败，将直接执行滚动操作而不显示可视化效果`)
			return false
		}

		// 1. 创建并插入可视化容器
		await chrome.scripting.executeScript({
			target: { tabId: tabId },
			func: (direction, selector) => {
				try {
					const target = selector ? document.querySelector(selector) : null
					const targetElement = target || document.documentElement

					// 检查目标是否可滚动
					const isScrollable = (el) => {
						// 水平或垂直滚动
						const hasScrollableContent = el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth
						const overflowValues =
							window.getComputedStyle(el).overflow +
							window.getComputedStyle(el).overflowY +
							window.getComputedStyle(el).overflowX
						const isOverflowScroll = /(auto|scroll)/.test(overflowValues)
						return hasScrollableContent && isOverflowScroll
					}

					if (target && !isScrollable(target)) {
						console.warn("滚动目标元素不可滚动")
						// 但仍继续创建可视化，来显示出错位置
					}

					// 创建滚动指示器容器
					let container = document.getElementById("coding-baby-scroll-container")
					if (!container) {
						container = document.createElement("div")
						container.id = "coding-baby-scroll-container"
						container.style.cssText = `
							position: fixed;
							top: 0;
							left: 0;
							width: 100%;
							height: 100%;
							pointer-events: none;
							z-index: 2147483646;
						`
						document.body.appendChild(container)
					}

					// 按方向确定鼠标指针起始位置和终点位置
					const isVertical = direction === "up" || direction === "down"
					const isHorizontal = direction === "left" || direction === "right"
					const isUp = direction === "up"
					const isLeft = direction === "left"

					// 创建或获取鼠标指针元素
					let pointer = document.getElementById("coding-baby-mouse-pointer")
					// 新增：创建或获取坐标显示元素
					let coordLabel = document.getElementById("coding-baby-mouse-coord-label")

					// 如果元素不存在，尝试创建
					if (!pointer) {
						pointer = document.createElement("div")
						pointer.id = "coding-baby-mouse-pointer"
						pointer.style.cssText = `
							position: absolute;
							width: 32px;
							height: 32px;
							background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M7,2l16,16l-8,1l4.5,9.5l-3,1.5l-4.5-9.5L7,24.5V2" fill="%23FF3355" stroke="%23FFFFFF" stroke-width="2"/></svg>');
							background-repeat: no-repeat;
							background-size: contain;
							transform-origin: 1px 1px;
							opacity: 0;
							filter: drop-shadow(0 0 4px rgba(0,0,0,0.5));
							display: block;
							transition: opacity 0.3s;
						`
						container.appendChild(pointer)
					}

					// 新增：创建坐标显示标签
					if (!coordLabel) {
						coordLabel = document.createElement("div")
						coordLabel.id = "coding-baby-mouse-coord-label"
						coordLabel.style.cssText = `
							position: absolute;
							background-color: transparent;
							padding: 2px 4px;
							font-size: 12px;
							font-family: 'Arial', sans-serif;
							font-weight: bold;
							white-space: nowrap;
							z-index: 2147483647;
							transform: translate(15px, -20px);
							color: #FF3355;
							text-shadow: 
								-1px -1px 0 #FFFFFF,
								1px -1px 0 #FFFFFF,
								-1px 1px 0 #FFFFFF,
								1px 1px 0 #FFFFFF;
							pointer-events: none;
						`
						container.appendChild(coordLabel)
					}

					// 创建滚动指示器
					const indicator = document.createElement("div")
					indicator.classList.add("coding-baby-scroll-indicator")

					// 创建滚动轨迹
					const trail = document.createElement("div")
					trail.classList.add("coding-baby-scroll-trail")

					// 设置起始位置和终点位置（基于窗口大小）
					const rightOffset = 95 // 更靠近右侧边缘（从85改为95）
					const bottomOffset = 95 // 距离底部的百分比位置

					// 不同滚动方向的位置设置
					let startPosX, startPosY, endPosX, endPosY

					if (isVertical) {
						// 垂直滚动 - 使用窗口右侧边缘
						startPosX = window.innerWidth * (rightOffset / 100)
						endPosX = startPosX

						if (isUp) {
							// 上滚：从底部到顶部
							startPosY = window.innerHeight * 0.8
							endPosY = window.innerHeight * 0.2
						} else {
							// 下滚：从顶部到底部
							startPosY = window.innerHeight * 0.2
							endPosY = window.innerHeight * 0.8
						}
					} else {
						// 水平滚动 - 使用窗口底部
						startPosY = window.innerHeight * 0.9 // 靠近底部（从0.5改为0.9）
						endPosY = startPosY

						if (isLeft) {
							// 左滚：从右到左
							startPosX = window.innerWidth * 0.8
							endPosX = window.innerWidth * 0.2
						} else {
							// 右滚：从左到右
							startPosX = window.innerWidth * 0.2
							endPosX = window.innerWidth * 0.8
						}
					}

					// 设置指示器样式 - 使用与鼠标点击相同的颜色方案
					indicator.style.cssText = `
						position: absolute;
						width: 50px;
						height: 50px;
						left: ${startPosX}px;
						top: ${startPosY}px;
						transform: translate(-50%, -50%);
						background-color: rgba(255, 51, 85, 0.8);
						border-radius: 50%;
						display: flex;
						justify-content: center;
						align-items: center;
						box-shadow: 0 0 15px rgba(255, 51, 85, 0.5);
						z-index: 2147483647;
						transition: all 0.02s linear;
					`

					// 箭头SVG - 根据方向调整
					let arrowSVG

					if (isVertical) {
						// 修复垂直滑动箭头方向问题，确保方向正确指向
						const arrowStartY = isUp ? "19" : "5" // 交换起点
						const arrowEndY = isUp ? "5" : "19" // 交换终点
						arrowSVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
							<path d="M12 ${arrowStartY}L12 ${arrowEndY}M12 ${arrowEndY}L6 ${isUp ? "11" : "13"}M12 ${arrowEndY}L18 ${isUp ? "11" : "13"}" 
							stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
						</svg>`
					} else {
						// 修复右滑箭头方向问题，确保方向正确指向
						const arrowStartX = isLeft ? "19" : "5" // 交换起点
						const arrowEndX = isLeft ? "5" : "19" // 交换终点
						arrowSVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
							<path d="M${arrowStartX} 12L${arrowEndX} 12M${arrowEndX} 12L${isLeft ? "13" : "11"} 6M${arrowEndX} 12L${isLeft ? "13" : "11"} 18" 
							stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
						</svg>`
					}

					indicator.innerHTML = arrowSVG

					// 设置滚动轨迹样式 - 半透明渐变，与指示器颜色匹配
					if (isVertical) {
						// 垂直滚动轨迹
						trail.style.cssText = `
							position: absolute;
							width: 24px;
							right: ${100 - rightOffset + 0.5}%;
							opacity: 0;
							background: linear-gradient(to ${isUp ? "bottom" : "top"}, 
								rgba(255, 51, 85, 0.6), 
								rgba(255, 51, 85, 0.1));
							border-radius: 12px;
							z-index: 2147483646;
						`

						// 设置轨迹的高度和位置（基于终点）
						const trailHeight = Math.abs(endPosY - startPosY) * 0.6
						trail.style.height = `${trailHeight}px`
						trail.style.top = isUp ? `${endPosY}px` : `${startPosY}px`
						trail.style.left = `${startPosX - 12}px` // 中心对齐
					} else {
						// 水平滚动轨迹
						trail.style.cssText = `
							position: absolute;
							height: 24px;
							opacity: 0;
							background: linear-gradient(to ${isLeft ? "right" : "left"}, 
								rgba(255, 51, 85, 0.6), 
								rgba(255, 51, 85, 0.1));
							border-radius: 12px;
							z-index: 2147483646;
						`

						// 设置轨迹的宽度和位置
						const trailWidth = Math.abs(endPosX - startPosX) * 0.6
						trail.style.width = `${trailWidth}px`
						trail.style.left = isLeft ? `${endPosX}px` : `${startPosX}px`
						trail.style.top = `${startPosY - 12}px` // 中心对齐
					}

					// 将元素添加到容器
					container.appendChild(trail)
					container.appendChild(indicator)

					// 设置鼠标位置（起始处）
					pointer.style.transform = `translate(${startPosX}px, ${startPosY}px)`
					pointer.style.opacity = "1.0"

					// 新增：显示初始坐标
					coordLabel.textContent = `X:${Math.round(startPosX)} Y:${Math.round(startPosY)}`
					coordLabel.style.left = `${startPosX}px`
					coordLabel.style.top = `${startPosY}px`
					coordLabel.style.display = "block"

					// 获取目标元素位置（如果有选择器）
					let targetPosition = null
					if (target) {
						const rect = target.getBoundingClientRect()
						targetPosition = {
							top: rect.top,
							left: rect.left,
							width: rect.width,
							height: rect.height,
						}

						// 添加目标指示框
						const targetIndicator = document.createElement("div")
						targetIndicator.style.cssText = `
							position: fixed;
							top: ${targetPosition.top}px;
							left: ${targetPosition.left}px;
							width: ${targetPosition.width}px;
							height: ${targetPosition.height}px;
							border: 2px solid rgba(255, 51, 85, 0.7);
							border-radius: 4px;
							pointer-events: none;
							box-sizing: border-box;
							opacity: 0;
							transition: opacity 0.3s;
						`
						container.appendChild(targetIndicator)

						// 显示指示框
						setTimeout(() => {
							targetIndicator.style.opacity = "1"
						}, 100)
					}

					// 显示轨迹
					setTimeout(() => {
						trail.style.opacity = "0.7"
					}, 100)

					return {
						success: true,
						startPosX,
						startPosY,
						endPosX,
						endPosY,
						targetSelector: selector,
					}
				} catch (error) {
					console.error("创建滚动可视化失败:", error)
					return { success: false, error: error.message }
				}
			},
			args: [direction, selector],
		})

		// 2. 执行滚动可视化逻辑（鼠标移动动画）- 但不执行实际滚动
		const result = await chrome.scripting
			.executeScript({
				target: { tabId: tabId },
				func: (direction, selector) => {
					return new Promise((resolve) => {
						try {
							const container = document.getElementById("coding-baby-scroll-container")
							const indicator = container.querySelector(".coding-baby-scroll-indicator")
							const pointer = document.getElementById("coding-baby-mouse-pointer")
							// 新增：获取坐标标签
							const coordLabel = document.getElementById("coding-baby-mouse-coord-label")

							if (!container || !indicator || !pointer) {
								console.error("找不到滚动动画所需的元素")
								return resolve(false)
							}

							// 提取当前位置和目标位置
							const startPos = {
								x: parseFloat(indicator.style.left),
								y: parseFloat(indicator.style.top),
							}

							// 确定终点位置（基于滚动方向）
							let endPos = { ...startPos }

							if (direction === "up" || direction === "down") {
								endPos.y = direction === "up" ? window.innerHeight * 0.2 : window.innerHeight * 0.8
							} else {
								endPos.x = direction === "left" ? window.innerWidth * 0.2 : window.innerWidth * 0.8
							}

							// 重要：不再执行实际滚动，只进行动画效果
							// 动画参数 - 减少时间使动画更快
							const animationDuration = 500 // 从780ms减少到500ms
							const startTime = performance.now()

							// 创建缓动函数
							const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)

							// 动画函数
							function animateScroll(timestamp) {
								const elapsed = timestamp - startTime
								const progress = Math.min(elapsed / animationDuration, 1)
								const easedProgress = easeOutCubic(progress)

								// 更新指示器位置
								const currentX = startPos.x + (endPos.x - startPos.x) * easedProgress
								const currentY = startPos.y + (endPos.y - startPos.y) * easedProgress

								indicator.style.left = `${currentX}px`
								indicator.style.top = `${currentY}px`

								// 更新鼠标指针位置
								pointer.style.transform = `translate(${currentX}px, ${currentY}px)`

								// 新增：更新坐标显示
								if (coordLabel) {
									coordLabel.textContent = `X:${Math.round(currentX)} Y:${Math.round(currentY)}`
									coordLabel.style.left = `${currentX}px`
									coordLabel.style.top = `${currentY}px`
									// 添加脉动效果
									const pulseScale = 1 + Math.sin(performance.now() / 200) * 0.05
									coordLabel.style.transform = `translate(15px, -20px) scale(${pulseScale})`
								}

								// 缩放效果
								const scale = 1 + Math.sin(progress * Math.PI) * 0.2
								indicator.style.transform = `translate(-50%, -50%) scale(${scale})`

								if (progress < 1) {
									requestAnimationFrame(animateScroll)
								} else {
									// 滚动完成，显示一会儿后淡出
									setTimeout(() => {
										// 淡出所有元素
										indicator.style.transition = "opacity 0.3s ease"
										indicator.style.opacity = "0"

										const trail = container.querySelector(".coding-baby-scroll-trail")
										if (trail) {
											trail.style.transition = "opacity 0.3s ease"
											trail.style.opacity = "0"
										}

										const targetIndicator = container.querySelector("div[style*='border: 2px solid']")
										if (targetIndicator) {
											targetIndicator.style.transition = "opacity 0.3s ease"
											targetIndicator.style.opacity = "0"
										}

										// 稍后再淡出鼠标指针和坐标显示（让它保持可见更长时间）
										setTimeout(() => {
											pointer.style.transition = "opacity 0.3s ease"
											pointer.style.opacity = "0"

											// 新增：淡出坐标显示
											if (coordLabel) {
												coordLabel.style.transition = "opacity 0.3s ease"
												coordLabel.style.opacity = "0"
											}

											// 最后移除所有元素
											setTimeout(() => {
												if (container.parentNode) {
													container.innerHTML = ""
												}
												resolve(true)
											}, 300)
										}, 200)
									}, 500)
								}
							}

							// 开始动画
							requestAnimationFrame(animateScroll)
						} catch (error) {
							console.error("执行滚动动画时出错:", error)
							resolve(false)
						}
					})
				},
				args: [direction, selector],
			})
			.then((scriptResult) => {
				if (!scriptResult || !scriptResult[0] || scriptResult[0].result !== true) {
					console.warn(`[VIZ Handler] 滚动可视化执行脚本返回失败状态: ${JSON.stringify(scriptResult)}`)
					return false
				}
				//console.log(`[VIZ Handler] 滚动可视化脚本执行成功`)
				return true
			})
			.catch((error) => {
				console.error(`[VIZ Handler] 执行滚动可视化脚本时出错:`, error)
				return false
			})

		return result
	} catch (error) {
		console.error(`[VIZ Handler] 执行滚动可视化时出错:`, error)
		return false
	}
}

/**
 * 执行滚动可视化包装函数，提供与interactionService兼容的函数签名
 * @param {number} tabId - 标签页ID
 * @param {string} direction - 滚动方向：'up', 'down', 'left', 'right'
 * @param {string|null} selector - 可选的元素选择器
 * @returns {Promise<boolean>} - 是否成功执行
 */
export async function visualizeScroll(tabId, direction, selector = null) {
	try {
		// 只执行滚动可视化动画，不再尝试实际滚动页面
		let visualizationSuccess = false
		let timeoutTriggered = false
		let timeoutId = null

		// 执行可视化动画
		const animationPromise = executeScrollVisualization(tabId, direction, selector)

		// 创建超时Promise
		const timeoutPromise = new Promise((resolve) => {
			timeoutId = setTimeout(() => {
				timeoutTriggered = true
				console.warn(`[VIZ Handler] 滚动可视化超时(5秒)，继续执行`)
				resolve(false)
			}, 5000)
		})

		// 使用Promise.race等待结果
		visualizationSuccess = await Promise.race([animationPromise, timeoutPromise])

		// 清理超时
		if (timeoutId) {
			clearTimeout(timeoutId)
			timeoutId = null
		}

		return visualizationSuccess
	} catch (error) {
		console.error(`[VIZ Handler] 滚动可视化失败: ${error.message}`)
		return false
	}
}

/**
 * 执行区域选择可视化
 * @param {string} topLeftStr - 左上角坐标字符串 "x,y"
 * @param {string} bottomRightStr - 右下角坐标字符串 "x,y"
 * @returns {Promise<boolean>} - 是否成功执行
 */
export async function executeAreaVisualization(topLeftStr, bottomRightStr) {
	try {
		// 获取当前活动标签页ID
		const tabId = getActiveTabId()
		if (!tabId) {
			throw new Error("无可用的标签页执行区域可视化")
		}

		//console.log(`[VIZ Handler] 执行标签页 ${tabId} 的区域可视化 (${topLeftStr} -> ${bottomRightStr})`)

		// 解析坐标
		const [tlX, tlY] = topLeftStr.split(",").map(Number)
		const [brX, brY] = bottomRightStr.split(",").map(Number)

		if (isNaN(tlX) || isNaN(tlY) || isNaN(brX) || isNaN(brY)) {
			console.error("[VIZ Handler] 无效的坐标格式")
			return false
		}

		// 确保可视化组件已初始化
		const isInitialized = await ensureVisualizationInitialized(tabId)
		if (!isInitialized) {
			console.warn(`[VIZ Handler] 初始化可视化组件失败，无法显示区域可视化效果`)
			return false
		}

		//console.log(`[VIZ Handler] 开始执行区域可视化脚本...`)
		const result = await chrome.scripting
			.executeScript({
				target: { tabId },
				func: (tlX, tlY, brX, brY) => {
					console.log(`[VIZ Script] 开始在页面内执行区域可视化 (${tlX},${tlY}) -> (${brX},${brY})`)

					return new Promise((resolve) => {
						try {
							// 获取或创建容器
							let container = document.getElementById("coding-baby-viz-container")
							if (!container) {
								container = document.createElement("div")
								container.id = "coding-baby-viz-container"
								container.style.cssText = `
									position: fixed;
									top: 0;
									left: 0;
									width: 100%;
									height: 100%;
									pointer-events: none;
									z-index: 2147483647;
									overflow: hidden;
								`
								document.body.appendChild(container)
							}

							// 创建区域框元素
							const areaBox = document.createElement("div")
							areaBox.id = "coding-baby-area-box"
							const boxWidth = brX - tlX
							const boxHeight = brY - tlY
							areaBox.style.cssText = `
								position: absolute;
								left: ${tlX}px;
								top: ${tlY}px;
								width: ${boxWidth}px;
								height: ${boxHeight}px;
								border: 3px solid #FF3355; /* 红色边框 */
								box-shadow: 0 0 0 1px #FFFFFF, 0 0 5px rgba(0,0,0,0.5); /* 白色描边和阴影 */
								background-color: rgba(255, 51, 85, 0.1); /* 淡红色背景 */
								box-sizing: border-box;
								opacity: 0;
								transition: opacity 0.3s ease-in-out;
								z-index: 2147483646;
							`
							container.appendChild(areaBox)

							// 创建左上角坐标标签
							const topLeftLabel = document.createElement("div")
							topLeftLabel.id = "coding-baby-area-label-tl"
							topLeftLabel.textContent = `X:${Math.round(tlX)} Y:${Math.round(tlY)}`
							topLeftLabel.style.cssText = `
								position: absolute;
								left: ${tlX}px;
								top: ${tlY}px;
								transform: translate(-100%, -100%) translateX(-5px) translateY(-5px); /* 定位到左上角外侧 */
								background-color: transparent;
								padding: 2px 4px;
								font-size: 12px;
								font-family: 'Arial', sans-serif;
								font-weight: bold;
								white-space: nowrap;
								color: #FF3355;
								text-shadow: 
									-1px -1px 0 #FFFFFF,
									1px -1px 0 #FFFFFF,
									-1px 1px 0 #FFFFFF,
									1px 1px 0 #FFFFFF; /* 白色描边 */
								pointer-events: none;
								opacity: 0;
								transition: opacity 0.3s ease-in-out;
								z-index: 2147483647;
							`
							container.appendChild(topLeftLabel)

							// 创建右下角坐标标签
							const bottomRightLabel = document.createElement("div")
							bottomRightLabel.id = "coding-baby-area-label-br"
							bottomRightLabel.textContent = `X:${Math.round(brX)} Y:${Math.round(brY)}`
							bottomRightLabel.style.cssText = `
								position: absolute;
								left: ${brX}px;
								top: ${brY}px;
								transform: translateX(5px) translateY(5px); /* 定位到右下角外侧 */
								background-color: transparent;
								padding: 2px 4px;
								font-size: 12px;
								font-family: 'Arial', sans-serif;
								font-weight: bold;
								white-space: nowrap;
								color: #FF3355;
								text-shadow: 
									-1px -1px 0 #FFFFFF,
									1px -1px 0 #FFFFFF,
									-1px 1px 0 #FFFFFF,
									1px 1px 0 #FFFFFF; /* 白色描边 */
								pointer-events: none;
								opacity: 0;
								transition: opacity 0.3s ease-in-out;
								z-index: 2147483647;
							`
							container.appendChild(bottomRightLabel)

							// 显示效果（渐入）
							requestAnimationFrame(() => {
								areaBox.style.opacity = "1"
								topLeftLabel.style.opacity = "1"
								bottomRightLabel.style.opacity = "1"
							})

							// 延迟一段时间后移除效果（渐出）
							const displayDuration = 2000 // 显示2秒
							setTimeout(() => {
								areaBox.style.opacity = "0"
								topLeftLabel.style.opacity = "0"
								bottomRightLabel.style.opacity = "0"

								// 动画结束后移除DOM元素
								setTimeout(() => {
									areaBox.remove()
									topLeftLabel.remove()
									bottomRightLabel.remove()
									// 如果容器为空，也可以移除容器
									if (container.childElementCount === 0) {
										container.remove()
									}
									resolve(true)
								}, 300) // 等待淡出动画完成
							}, displayDuration)
						} catch (error) {
							console.error("[VIZ Script] 执行区域可视化时出错:", error)
							resolve(false)
						}
					})
				},
				args: [tlX, tlY, brX, brY],
			})
			.catch((error) => {
				console.error(`[VIZ Handler] 执行区域可视化脚本失败: ${error.message}`)
				return [{ result: false }]
			})

		const success = result && result[0] && result[0].result
		//console.log(`[VIZ Handler] 标签页 ${tabId} 的区域可视化执行${success ? "完成" : "失败"}`)
		return success
	} catch (error) {
		console.error(`[VIZ Handler] 执行区域可视化时出错:`, error)
		return false
	}
}
