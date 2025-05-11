/**
 * scrollService.js
 * 高性能并行滚动服务
 * 同时采用多种滚动策略，确保快速响应和最大兼容性
 */

import { getActiveTabId } from "./tabService.js"
import * as screenshotService from "./screenshotService.js"
import * as domUtils from "../utils/domUtils.js"
import * as visualizationHandler from "../handlers/visualizationHandler.js"
import { debugTarget } from "./debuggerService.js"

// 添加滚动锁定机制，防止多种方法同时生效
const scrollLocks = new Map()

/**
 * 执行页面滚动，采用并行多策略方式
 * @param {string} direction 滚动方向：up, down, left, right
 * @param {string|null} selector 可选的目标元素选择器
 * @returns {Promise<void>} 滚动操作完成的Promise
 */
export async function performScroll(direction, selector = null) {
	// 获取当前活动标签页ID
	const tabId = getActiveTabId()
	if (!tabId) {
		throw new Error("无可用的标签页执行滚动操作")
	}

	if (!direction || !["up", "down", "left", "right"].includes(direction)) {
		throw new Error(`无效的滚动方向: ${direction}`)
	}

	console.log(`[BG_WS] Scrolling ${direction} on tab ${tabId}${selector ? ` (selector: ${selector})` : ""}`)

	try {
		// 重置该标签页的滚动锁定状态
		scrollLocks.set(tabId, { locked: false, method: null })

		// 1. 获取初始滚动位置（用于后续验证）
		const initialPosition = await getScrollPosition(tabId, selector)

		// 2. 启动滚动动画效果（不阻塞，仅提供视觉反馈）
		visualizationHandler.visualizeScroll(tabId, direction, selector).catch((err) => {
			console.warn(`[BG_WS] 滚动可视化错误（不影响实际滚动）: ${err.message}`)
		})

		// 3. 创建锁定检查函数，确保只有一种滚动方法生效
		const checkAndLock = async (method) => {
			// 如果已被锁定，表示其他方法已生效，直接返回未成功
			const lockInfo = scrollLocks.get(tabId)
			if (lockInfo && lockInfo.locked === true) {
				return { success: false, method, lockedBy: lockInfo.method, locked: true }
			}

			// 检查滚动是否已生效
			const currentPosition = await getScrollPosition(tabId, selector)
			const isEffective = verifyScrollEffect(initialPosition, currentPosition, direction)

			// 打印每种方法的效果检测结果
			if (isEffective) {
				console.log(`[BG_WS] 滚动方法 ${method} 成功产生滚动效果！`)
			}

			// 如果滚动已生效，锁定以防止其他方法再次滚动
			if (isEffective) {
				scrollLocks.set(tabId, { locked: true, method: method })
				console.log(`[BG_WS] 滚动已生效(${method})，锁定以防止重复滚动`)
				return { success: true, method, effective: true }
			}

			return { success: true, method, effective: false }
		}

		// 4. 并行但有保护地执行滚动策略
		const standardPromise = standardScrollStrategy(tabId, direction, selector).then((result) =>
			checkAndLock("standard").then((check) => ({ ...result, ...check })),
		)

		const wheelPromise = new Promise((resolve) => {
			// 给标准方法50ms的优先权
			setTimeout(() => {
				// 如果已锁定，跳过执行
				const lockInfo = scrollLocks.get(tabId)
				if (lockInfo && lockInfo.locked === true) {
					resolve({ success: false, method: "wheel", lockedBy: lockInfo.method, locked: true })
					return
				}

				// 否则执行滚轮策略
				wheelEventStrategy(tabId, direction, selector)
					.then((result) => checkAndLock("wheel").then((check) => ({ ...result, ...check })))
					.then(resolve)
			}, 50)
		})

		const advancedPromise = new Promise((resolve) => {
			// 给前两种方法100ms的优先权
			setTimeout(() => {
				// 如果已锁定，跳过执行
				const lockInfo = scrollLocks.get(tabId)
				if (lockInfo && lockInfo.locked === true) {
					resolve({ success: false, method: "advanced", lockedBy: lockInfo.method, locked: true })
					return
				}

				// 否则执行高级策略
				advancedScrollStrategy(tabId, direction, selector)
					.then((result) => checkAndLock("advanced").then((check) => ({ ...result, ...check })))
					.then(resolve)
			}, 100)
		})

		// 5. 等待任一滚动策略成功或全部完成
		const effectiveMethodPromise = new Promise((resolve) => {
			const checkInterval = setInterval(() => {
				const lockInfo = scrollLocks.get(tabId)
				if (lockInfo && lockInfo.locked === true) {
					clearInterval(checkInterval)
					resolve({ success: true, method: lockInfo.method, locked: true })
				}
			}, 20)

			// 最多检查250ms
			setTimeout(() => {
				clearInterval(checkInterval)
			}, 250)
		})

		const scrollResult = await Promise.race([
			// 使用有效方法名的锁定检查
			effectiveMethodPromise,

			// 所有策略完成
			Promise.all([standardPromise, wheelPromise, advancedPromise]).then((results) => {
				// 确定哪些策略有效
				const effectiveStrategies = []
				if (results[0].effective) effectiveStrategies.push("standard")
				if (results[1].effective) effectiveStrategies.push("wheel")
				if (results[2].effective) effectiveStrategies.push("advanced")

				// 只在调试模式或有效策略存在时输出日志
				if (effectiveStrategies.length > 0) {
					console.log(`[BG_WS] 有效滚动策略: ${effectiveStrategies.join(", ")}`)
				}

				// 锁定状态最终检查
				const lockInfo = scrollLocks.get(tabId)
				if (lockInfo && lockInfo.locked === true) {
					return { success: true, method: lockInfo.method, locked: true }
				}

				// 找出成功并有效的结果
				const effectiveResult = results.find((r) => r.effective === true)
				if (effectiveResult) {
					return effectiveResult
				}

				// 如果没有有效结果，但有成功执行的结果
				const successResult = results.find((r) => r.success === true && !r.locked)
				if (successResult) {
					return successResult
				}

				// 都失败了就返回第一个结果
				return results[0]
			}),

			// 确保250ms内返回
			new Promise((resolve) => setTimeout(() => resolve({ success: true, method: "timeout" }), 250)),
		])

		// 6. 验证最终滚动效果
		try {
			// 进行最终验证前先等待一下，让所有滚动操作有机会完成
			await new Promise((resolve) => setTimeout(resolve, 50))

			const finalPosition = await getScrollPosition(tabId, selector)
			const isEffective = verifyScrollEffect(initialPosition, finalPosition, direction)

			// 确定要显示的方法名称
			let displayMethod = scrollResult.method
			if (scrollResult.locked && scrollResult.lockedBy) {
				displayMethod = scrollResult.lockedBy
			} else if (scrollResult.method === "timeout") {
				const lockInfo = scrollLocks.get(tabId)
				if (lockInfo && lockInfo.locked && lockInfo.method) {
					displayMethod = lockInfo.method
				}
			}

			// 简化日志 - 只显示重要信息
			console.log(`[BG_WS] 滚动${isEffective ? "成功" : "可能未生效"} (方法: ${displayMethod || "未知"})`)

			// 如果滚动未生效，添加日志（但不重试，避免重复滚动）
			if (!isEffective) {
				console.log(`[BG_WS] 滚动未检测到明显效果，可能已到达页面边缘或内容不足以滚动`)
			}
		} catch (err) {
			console.warn(`[BG_WS] 滚动验证错误: ${err.message}`)
		}

		// 7. 添加短暂延迟，确保滚动效果已完成
		await new Promise((resolve) => setTimeout(resolve, 150))

		// 清理锁定状态
		scrollLocks.delete(tabId)
		return
	} catch (error) {
		console.error(`[BG_WS] 滚动操作出错: ${error.message}`)
		// 确保清理锁定状态
		scrollLocks.delete(tabId)
		throw error
	}
}

/**
 * 策略1: 标准DOM滚动方法
 * 使用标准的scrollBy和scrollTop/Left属性
 */
async function standardScrollStrategy(tabId, direction, selector) {
	try {
		const result = await chrome.scripting.executeScript({
			target: { tabId },
			func: (direction, selector) => {
				// 计算滚动量
				const scrollAmount =
					direction === "up" || direction === "down"
						? window.innerHeight * 0.7 // 垂直滚动量
						: window.innerWidth * 0.7 // 水平滚动量

				// 确定滚动目标元素
				let target = selector ? document.querySelector(selector) : null
				if (!target) {
					target = document.scrollingElement || document.documentElement || document.body
				}

				// 记录初始位置
				const initialTop = target.scrollTop
				const initialLeft = target.scrollLeft

				// 尝试使用scrollBy方法
				try {
					target.scrollBy({
						top: direction === "down" ? scrollAmount : direction === "up" ? -scrollAmount : 0,
						left: direction === "right" ? scrollAmount : direction === "left" ? -scrollAmount : 0,
						behavior: "auto", // 使用'auto'而非'smooth'以确保立即滚动
					})
				} catch (e) {
					// 如果scrollBy失败，尝试直接设置scrollTop/Left
					if (direction === "down") target.scrollTop += scrollAmount
					else if (direction === "up") target.scrollTop -= scrollAmount
					else if (direction === "right") target.scrollLeft += scrollAmount
					else if (direction === "left") target.scrollLeft -= scrollAmount
				}

				// 返回结果，包括滚动前后位置信息
				return {
					success: true,
					initialTop,
					initialLeft,
					currentTop: target.scrollTop,
					currentLeft: target.scrollLeft,
					scrolled: Math.abs(target.scrollTop - initialTop) > 5 || Math.abs(target.scrollLeft - initialLeft) > 5,
				}
			},
			args: [direction, selector],
		})

		if (!result || !result[0] || !result[0].result) {
			return { success: false, method: "standard", error: "执行结果无效" }
		}

		// 简化日志输出
		if (result[0].result.scrolled) {
			console.log(`[BG_WS] 标准滚动成功`)
		}

		return { ...result[0].result, method: "standard" }
	} catch (error) {
		return { success: false, method: "standard", error: error.message }
	}
}

/**
 * 策略2: 模拟滚轮事件
 * 创建和分发真实的滚轮事件，绕过某些网站的滚动拦截
 */
async function wheelEventStrategy(tabId, direction, selector) {
	try {
		// 创建滚轮事件参数
		const deltaY = direction === "down" ? 120 : direction === "up" ? -120 : 0
		const deltaX = direction === "right" ? 120 : direction === "left" ? -120 : 0

		const result = await chrome.scripting.executeScript({
			target: { tabId },
			func: (deltaX, deltaY, selector) => {
				try {
					// 确定目标元素（优先使用选择器指定的元素）
					let target
					if (selector) {
						target = document.querySelector(selector)
					}

					// 如果没有通过选择器找到元素，尝试找到页面中心位置的元素
					if (!target) {
						const centerX = window.innerWidth / 2
						const centerY = window.innerHeight / 2
						target = document.elementFromPoint(centerX, centerY) || document.documentElement
					}

					// 创建四个WheelEvent事件模拟连续滚动（提高成功率）
					for (let i = 0; i < 4; i++) {
						const wheelEvent = new WheelEvent("wheel", {
							bubbles: true,
							cancelable: true,
							view: window,
							deltaX: deltaX,
							deltaY: deltaY,
							deltaMode: 0, // 使用像素作为单位
							clientX: window.innerWidth / 2,
							clientY: window.innerHeight / 2,
						})

						target.dispatchEvent(wheelEvent)
					}

					return { success: true }
				} catch (e) {
					return { success: false, error: e.message }
				}
			},
			args: [deltaX, deltaY, selector],
		})

		if (!result || !result[0] || !result[0].result) {
			return { success: false, method: "wheel", error: "执行结果无效" }
		}

		// 简化日志输出
		if (result[0].result.success) {
			console.log(`[BG_WS] 滚轮事件执行成功`)
		}

		return { ...result[0].result, method: "wheel" }
	} catch (error) {
		return { success: false, method: "wheel", error: error.message }
	}
}

/**
 * 策略3: 高级注入式滚动
 * 查找多种可能的滚动容器，针对特殊网站优化
 */
async function advancedScrollStrategy(tabId, direction, selector) {
	try {
		const result = await chrome.scripting.executeScript({
			target: { tabId },
			func: (direction, selector) => {
				try {
					// 计算滚动参数
					const amount = direction === "up" || direction === "down" ? window.innerHeight * 0.7 : window.innerWidth * 0.7

					// 查找所有可能的滚动容器
					const findScrollContainers = () => {
						const containers = []

						// 1. 添加标准容器
						containers.push(document.documentElement, document.body)
						if (document.scrollingElement) containers.push(document.scrollingElement)

						// 2. 查找具有overflow样式的元素
						const overflowContainers = Array.from(document.querySelectorAll("*")).filter((el) => {
							try {
								const style = window.getComputedStyle(el)
								const hasOverflow =
									["auto", "scroll", "overlay"].includes(style.overflowY) ||
									["auto", "scroll", "overlay"].includes(style.overflowX) ||
									["auto", "scroll", "overlay"].includes(style.overflow)

								// 检查元素尺寸
								const rect = el.getBoundingClientRect()
								return (
									hasOverflow &&
									rect.width > 100 &&
									rect.height > 100 && // 过滤掉太小的元素
									(el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)
								) // 存在可滚动内容
							} catch (e) {
								return false
							}
						})

						// 3. 查找通用内容容器
						const contentContainers = Array.from(
							document.querySelectorAll(
								'main, [role="main"], #main, .main, .content, #content, ' +
									"article, .article, .page-content, .scroll-container, " +
									".scrollable, [data-scroll], [data-scrollable]",
							),
						)

						return [...containers, ...overflowContainers, ...contentContainers]
					}

					// 如果有选择器，优先使用
					const targetContainers = selector ? [document.querySelector(selector)] : []

					// 加入一般性滚动容器
					const allContainers = [...targetContainers, ...findScrollContainers()].filter((el) => el !== null)

					// 记录滚动前状态
					const winScrollY = window.scrollY
					const winScrollX = window.scrollX

					// 定义多种滚动尝试方法
					const scrollMethods = [
						// 方法1: 原生window滚动函数
						() => {
							if (direction === "down") window.scrollBy(0, amount)
							else if (direction === "up") window.scrollBy(0, -amount)
							else if (direction === "right") window.scrollBy(amount, 0)
							else if (direction === "left") window.scrollBy(-amount, 0)
						},

						// 方法2: scrollBy with options
						(container) => {
							container.scrollBy({
								top: direction === "down" ? amount : direction === "up" ? -amount : 0,
								left: direction === "right" ? amount : direction === "left" ? -amount : 0,
								behavior: "auto",
							})
						},

						// 方法3: 直接设置scrollTop/Left
						(container) => {
							if (direction === "down") container.scrollTop += amount
							else if (direction === "up") container.scrollTop -= amount
							else if (direction === "right") container.scrollLeft += amount
							else if (direction === "left") container.scrollLeft -= amount
						},

						// 方法4: 使用scrollIntoView (垂直方向)
						(container) => {
							if (direction !== "up" && direction !== "down") return

							// 找到合适的目标元素
							const rect = container.getBoundingClientRect()
							const targetY = direction === "down" ? rect.bottom + 100 : rect.top - 100

							const elements = document.elementsFromPoint(rect.left + rect.width / 2, targetY)
							if (elements && elements.length > 0) {
								elements[0].scrollIntoView({
									behavior: "auto",
									block: direction === "down" ? "end" : "start",
								})
							}
						},
					]

					// 对每个容器尝试各种滚动方法
					for (const container of allContainers) {
						try {
							// 记录初始位置
							const initialTop = container.scrollTop
							const initialLeft = container.scrollLeft

							// 尝试所有滚动方法
							for (const method of scrollMethods) {
								try {
									method(container)

									// 检查是否有效
									if (
										Math.abs(container.scrollTop - initialTop) > 5 ||
										Math.abs(container.scrollLeft - initialLeft) > 5
									) {
										return {
											success: true,
											container: container.tagName + (container.id ? `#${container.id}` : ""),
										}
									}
								} catch (e) {
									/* 继续尝试下一个方法 */
								}
							}
						} catch (e) {
							/* 继续尝试下一个容器 */
						}
					}

					// 检查window滚动是否有效（全局检查）
					if (Math.abs(window.scrollY - winScrollY) > 5 || Math.abs(window.scrollX - winScrollX) > 5) {
						return { success: true, container: "window" }
					}

					// 所有尝试都失败
					return { success: false, error: "所有滚动尝试均未生效" }
				} catch (e) {
					return { success: false, error: e.message }
				}
			},
			args: [direction, selector],
		})

		if (!result || !result[0] || !result[0].result) {
			return { success: false, method: "advanced", error: "执行结果无效" }
		}

		// 简化日志输出
		if (result[0].result.success) {
			console.log(`[BG_WS] 高级滚动成功${result[0].result.container ? `: ${result[0].result.container}` : ""}`)
		}

		return { ...result[0].result, method: "advanced" }
	} catch (error) {
		return { success: false, method: "advanced", error: error.message }
	}
}

/**
 * 获取当前滚动位置
 * @param {number} tabId - 标签页ID
 * @param {string|null} selector - 可选的元素选择器
 * @returns {Promise<Object>} 滚动位置信息
 */
async function getScrollPosition(tabId, selector) {
	try {
		const position = await chrome.scripting.executeScript({
			target: { tabId },
			func: (selector) => {
				const positions = {}

				// 1. 记录窗口滚动位置
				positions.window = {
					scrollTop: window.scrollY || 0,
					scrollLeft: window.scrollX || 0,
				}

				// 2. 记录文档元素位置
				positions.document = {
					scrollTop: document.documentElement.scrollTop || 0,
					scrollLeft: document.documentElement.scrollLeft || 0,
				}

				// 3. 记录body位置
				positions.body = {
					scrollTop: document.body.scrollTop || 0,
					scrollLeft: document.body.scrollLeft || 0,
				}

				// 4. 如果有选择器，记录指定元素位置
				if (selector) {
					const target = document.querySelector(selector)
					if (target) {
						positions.target = {
							scrollTop: target.scrollTop || 0,
							scrollLeft: target.scrollLeft || 0,
						}
					}
				}

				// 5. 查找主要内容容器
				const contentContainers = Array.from(document.querySelectorAll('main, [role="main"], #main, .content, #content'))

				if (contentContainers.length > 0) {
					const main = contentContainers[0]
					positions.main = {
						scrollTop: main.scrollTop || 0,
						scrollLeft: main.scrollLeft || 0,
					}
				}

				// 6. 查找所有大型可滚动容器
				const scrollContainers = Array.from(document.querySelectorAll("*"))
					.filter((el) => {
						try {
							const style = window.getComputedStyle(el)
							const hasOverflow =
								["auto", "scroll", "overlay"].includes(style.overflowY) ||
								["auto", "scroll", "overlay"].includes(style.overflowX)

							const rect = el.getBoundingClientRect()
							return (
								hasOverflow &&
								rect.width > 100 &&
								rect.height > 100 &&
								(el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)
							)
						} catch (e) {
							return false
						}
					})
					.slice(0, 5) // 只检查最多5个容器以避免过多开销

				scrollContainers.forEach((container, index) => {
					positions[`scrollable_${index}`] = {
						scrollTop: container.scrollTop || 0,
						scrollLeft: container.scrollLeft || 0,
						element: container.tagName + (container.id ? `#${container.id}` : ""),
					}
				})

				return positions
			},
			args: [selector],
		})

		return position[0].result
	} catch (error) {
		console.error(`[BG_WS] 获取滚动位置失败: ${error.message}`)
		return { window: { scrollTop: 0, scrollLeft: 0 } }
	}
}

/**
 * 验证滚动是否有效
 * @param {Object} initialPos - 初始滚动位置
 * @param {Object} currentPos - 当前滚动位置
 * @param {string} direction - 滚动方向
 * @returns {boolean} 是否有效滚动
 */
function verifyScrollEffect(initialPos, currentPos, direction) {
	const isVertical = direction === "up" || direction === "down"
	let anyScrolled = false
	let effectiveContainers = []

	// 遍历所有容器，检查是否有任何有效滚动
	for (const key in currentPos) {
		if (!initialPos[key]) continue

		const initial = initialPos[key]
		const current = currentPos[key]

		// 根据方向检查相应的滚动属性
		const diff = isVertical
			? Math.abs(current.scrollTop - initial.scrollTop)
			: Math.abs(current.scrollLeft - initial.scrollLeft)

		// 超过1px视为有效滚动（降低门槛以捕获小幅度滚动）
		if (diff > 1) {
			effectiveContainers.push(`${key}(${diff}px)`)
			anyScrolled = true
		}
	}

	// 只在有滚动时输出日志，简化日志输出
	if (anyScrolled) {
		console.log(`[BG_WS] 检测到有效滚动: ${effectiveContainers.join(", ")}`)
	}

	return anyScrolled
}
