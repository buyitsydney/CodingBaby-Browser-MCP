#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { ChromeExtensionClient } from "./chrome-client.js"
import { registerMcpTools } from "./mcp-tools.js"
import { registerBatchTools } from "./batch-commands.js"

// 创建Chrome扩展客户端实例
const chromeClient = new ChromeExtensionClient()

// 标记进程是否正在关闭
let isShuttingDown = false

// --- 加强信号处理 ---
// 优雅关闭处理函数
async function gracefulShutdown(signal) {
	// 防止重复关闭
	if (isShuttingDown) {
		console.error(`已经在关闭过程中，忽略${signal}信号`)
		return
	}
	isShuttingDown = true

	console.error(`\n===== 接收到${signal}信号，开始优雅关闭... =====`)
	console.error(`进程ID: ${process.pid}`)

	try {
		// 确保chromeClient已初始化后再调用dispose
		if (chromeClient) {
			console.error("正在关闭Chrome客户端连接...")

			// 使用更长的超时确保干净关闭
			const cleanupTimeout = setTimeout(() => {
				console.error("客户端关闭操作超时，准备强制退出")
				forceExit(1)
			}, 5000)

			await chromeClient.dispose()
			clearTimeout(cleanupTimeout)

			console.error("Chrome客户端连接已关闭")

			// 等待一小段时间确保所有资源释放
			console.error("等待资源释放...")
			await new Promise((resolve) => setTimeout(resolve, 1000))
		} else {
			console.error("Chrome客户端未初始化，无需关闭")
		}
	} catch (error) {
		console.error("关闭过程中出错:", error)
	} finally {
		console.error("===== 进程即将退出 =====")
		forceExit(0)
	}
}

// 强制退出函数
function forceExit(code) {
	// 强制退出，确保不会被挂起
	console.error(`准备退出，代码: ${code}`)

	// 添加最后的安全网，确保在超时后强制退出
	const forceKillTimer = setTimeout(() => {
		console.error("超时强制退出！")
		process.exit(code || 1)
	}, 3000)

	// 防止定时器阻止进程退出
	forceKillTimer.unref()

	// 正常退出
	process.exit(code)
}

// 处理各种退出信号
process.on("SIGINT", () => gracefulShutdown("SIGINT"))
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
process.on("SIGHUP", () => gracefulShutdown("SIGHUP"))

// 处理未捕获的异常和拒绝的Promise
process.on("uncaughtException", (err) => {
	console.error("未捕获的异常:", err)
	gracefulShutdown("uncaughtException")
})

process.on("unhandledRejection", (reason) => {
	console.error("未处理的Promise拒绝:", reason)
	gracefulShutdown("unhandledRejection")
})

// 处理正常退出
process.on("exit", (code) => {
	console.error(`进程退出，代码: ${code}`)
})

// --- 信号处理结束 ---

// 创建MCP服务器
const server = new McpServer({
	name: "codingbaby-browser-mcp",
	version: "1.0.0",
})

// 注册工具
registerMcpTools(server, chromeClient)
// 注册批处理工具
registerBatchTools(server, chromeClient)

// 连接到标准输入/输出传输并启动服务器
await server.connect(new StdioServerTransport())
