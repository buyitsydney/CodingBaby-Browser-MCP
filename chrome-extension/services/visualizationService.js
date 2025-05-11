/**
 * 鼠标可视化服务
 * 负责在浏览器中创建和控制鼠标指针的视觉效果
 */

// 存储当前指针元素的引用
let pointerElement = null
let pointerContainer = null
let isAnimating = false

/**
 * 初始化鼠标可视化容器
 * 确保只初始化一次
 */
export function initializeVisualizer() {
	if (pointerContainer) {
		return // 已经初始化
	}

	console.log("[VIZ] 初始化鼠标可视化组件")

	// 创建容器元素
	pointerContainer = document.createElement("div")
	pointerContainer.id = "coding-baby-mouse-container"
	pointerContainer.style.cssText = `
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		z-index: 2147483647;
		overflow: hidden;
	`

	// 创建鼠标指针元素
	pointerElement = document.createElement("div")
	pointerElement.id = "coding-baby-mouse-pointer"
	pointerElement.style.cssText = `
		position: absolute;
		width: 24px;
		height: 24px;
		background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M7,2l12,11.2l-5.8,0.5l3.3,7.3l-2.2,1l-3.2-7.4L7,18.5V2" fill="%23333" stroke="%23FFF" stroke-width="1"/></svg>');
		background-repeat: no-repeat;
		background-size: contain;
		transform-origin: 1px 1px;
		opacity: 0.9;
		filter: drop-shadow(0 0 2px rgba(0,0,0,0.3));
		transition: opacity 0.3s ease;
		display: none;
	`

	// 创建点击效果元素
	const clickEffect = document.createElement("div")
	clickEffect.id = "coding-baby-mouse-click-effect"
	clickEffect.style.cssText = `
		position: absolute;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: radial-gradient(circle, rgba(66,133,244,0.6) 0%, rgba(66,133,244,0) 70%);
		transform: translate(-50%, -50%) scale(0);
		pointer-events: none;
		opacity: 0;
	`

	// 添加元素到容器
	pointerContainer.appendChild(pointerElement)
	pointerContainer.appendChild(clickEffect)

	// 添加容器到页面
	document.body.appendChild(pointerContainer)
}

/**
 * 创建一条贝塞尔曲线路径
 * @param {number} startX - 起始X坐标
 * @param {number} startY - 起始Y坐标
 * @param {number} endX - 目标X坐标
 * @param {number} endY - 目标Y坐标
 * @returns {Array} - 路径点数组
 */
function createPath(startX, startY, endX, endY) {
	// 计算控制点（稍微偏移直线路径，创建自然曲线）
	const distance = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2))
	const midX = (startX + endX) / 2
	const midY = (startY + endY) / 2
	const controlOffsetX = (Math.random() - 0.5) * (distance * 0.2)
	const controlOffsetY = (Math.random() - 0.5) * (distance * 0.2)

	// 控制点坐标
	const controlX = midX + controlOffsetX
	const controlY = midY + controlOffsetY

	// 生成路径点
	const points = []
	const steps = Math.max(Math.ceil(distance / 10), 20) // 至少20个点，确保平滑

	for (let i = 0; i <= steps; i++) {
		const t = i / steps
		// 二次贝塞尔曲线公式
		const x = Math.pow(1 - t, 2) * startX + 2 * (1 - t) * t * controlX + Math.pow(t, 2) * endX
		const y = Math.pow(1 - t, 2) * startY + 2 * (1 - t) * t * controlY + Math.pow(t, 2) * endY
		points.push({ x, y })
	}

	return points
}

/**
 * 执行鼠标动画移动
 * @param {number} startX - 起始X坐标
 * @param {number} startY - 起始Y坐标
 * @param {number} endX - 目标X坐标
 * @param {number} endY - 目标Y坐标
 * @returns {Promise<void>}
 */
function animatePointer(startX, startY, endX, endY) {
	return new Promise((resolve) => {
		if (!pointerElement) {
			console.error("[VIZ] 鼠标指针元素不存在，无法执行动画")
			resolve()
			return
		}

		// 生成移动路径
		const path = createPath(startX, startY, endX, endY)
		const distance = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2))

		// 计算动画总时间（距离远的移动时间更长）
		const baseDuration = 500 // 基础动画时间 (ms)
		const duration = Math.min(baseDuration + distance / 5, 1000) // 最长1秒

		// 确保指针可见
		pointerElement.style.display = "block"
		pointerElement.style.opacity = "0.9"

		// 记录动画开始时间
		const startTime = performance.now()
		isAnimating = true

		// 执行动画
		function step(timestamp) {
			if (!isAnimating) {
				resolve()
				return
			}

			const elapsed = timestamp - startTime
			const progress = Math.min(elapsed / duration, 1)

			if (progress < 1) {
				// 计算当前位置
				const pointIndex = Math.min(Math.floor(progress * path.length), path.length - 1)
				const { x, y } = path[pointIndex]

				// 更新指针位置
				pointerElement.style.transform = `translate(${x}px, ${y}px)`

				// 继续动画
				requestAnimationFrame(step)
			} else {
				// 动画完成
				pointerElement.style.transform = `translate(${endX}px, ${endY}px)`
				isAnimating = false
				resolve()
			}
		}

		// 开始动画循环
		requestAnimationFrame(step)
	})
}

/**
 * 显示点击效果
 * @param {number} x - 点击X坐标
 * @param {number} y - 点击Y坐标
 */
function showClickEffect(x, y) {
	const clickEffect = document.getElementById("coding-baby-mouse-click-effect")
	if (!clickEffect) return

	// 定位点击效果
	clickEffect.style.left = `${x}px`
	clickEffect.style.top = `${y}px`

	// 重置动画
	clickEffect.style.animation = "none"
	clickEffect.offsetHeight // 触发重绘

	// 应用动画
	clickEffect.style.animation = "coding-baby-click-effect 0.5s ease-out forwards"

	// 添加一次性动画，如果不存在
	if (!document.getElementById("coding-baby-click-animation")) {
		const style = document.createElement("style")
		style.id = "coding-baby-click-animation"
		style.textContent = `
			@keyframes coding-baby-click-effect {
				0% { 
					transform: translate(-50%, -50%) scale(0); 
					opacity: 0.8;
				}
				100% { 
					transform: translate(-50%, -50%) scale(1.5); 
					opacity: 0;
				}
			}
		`
		document.head.appendChild(style)
	}
}

/**
 * 执行鼠标移动和点击的可视化
 * @param {number} targetX - 目标X坐标
 * @param {number} targetY - 目标Y坐标
 * @returns {Promise<void>}
 */
export async function visualizeMouseClick(targetX, targetY) {
	// 确保可视化组件已初始化
	initializeVisualizer()

	// 获取当前鼠标位置或使用默认起始位置
	let startX, startY

	if (pointerElement && pointerElement.style.display === "block") {
		// 从当前位置继续
		const transform = pointerElement.style.transform
		const match = transform.match(/translate\((\d+\.?\d*)px,\s*(\d+\.?\d*)px\)/)

		if (match) {
			startX = parseFloat(match[1])
			startY = parseFloat(match[2])
		} else {
			// 默认从右上角开始
			startX = window.innerWidth - 100
			startY = 100
		}
	} else {
		// 默认从右上角开始
		startX = window.innerWidth - 100
		startY = 100
	}

	// 取消正在进行的动画
	isAnimating = false

	try {
		// 执行移动动画
		await animatePointer(startX, startY, targetX, targetY)

		// 显示点击效果
		showClickEffect(targetX, targetY)

		// 在点击后保持指针可见一段时间，然后淡出
		setTimeout(() => {
			if (pointerElement) {
				pointerElement.style.opacity = "0"
				setTimeout(() => {
					if (pointerElement) {
						pointerElement.style.display = "none"
					}
				}, 300)
			}
		}, 2000)
	} catch (error) {
		console.error("[VIZ] 鼠标动画发生错误:", error)
	}
}

/**
 * 清理和移除可视化元素
 */
export function cleanupVisualizer() {
	if (pointerContainer) {
		document.body.removeChild(pointerContainer)
		pointerContainer = null
		pointerElement = null
	}

	// 移除动画样式
	const animStyle = document.getElementById("coding-baby-click-animation")
	if (animStyle) {
		document.head.removeChild(animStyle)
	}
}
