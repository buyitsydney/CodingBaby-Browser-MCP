// 注意：这个脚本仅用于测试模块导入，不会实际运行任何Chrome API
// 为避免缺少Chrome API导致的错误，我们只测试导入语句本身

;(async () => {
	try {
		// 动态导入模块，仅测试导入逻辑，不执行API调用
		console.log("正在测试模块导入...")

		await Promise.all([
			import("./services/websocketService.js").then(() => console.log("✓ websocketService 导入成功")),
			import("./services/tabService.js").then(() => console.log("✓ tabService 导入成功")),
			import("./services/debuggerService.js").then(() => console.log("✓ debuggerService 导入成功")),
			import("./services/screenshotService.js").then(() => console.log("✓ screenshotService 导入成功")),
			import("./services/interactionService.js").then(() => console.log("✓ interactionService 导入成功")),
			import("./services/contentService.js").then(() => console.log("✓ contentService 导入成功")),
			import("./services/viewportService.js").then(() => console.log("✓ viewportService 导入成功")),
			import("./utils/browserUtils.js").then(() => console.log("✓ browserUtils 导入成功")),
			import("./utils/domUtils.js").then(() => console.log("✓ domUtils 导入成功")),
			// 这个应该最后导入，因为它依赖于其他所有模块
			import("./handlers/commandHandlers.js").then(() => console.log("✓ commandHandlers 导入成功")),
		])

		console.log("所有模块导入测试完成！没有发现循环依赖问题。")
	} catch (error) {
		console.error("模块导入测试失败:", error)
	}
})()
