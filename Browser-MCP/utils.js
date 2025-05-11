// 正确格式化响应内容，将截图转换为MCP图像格式
export function formatResponse(result) {
	if (!result) return { content: [{ type: "text", text: JSON.stringify({ status: "error", message: "No result" }) }] }

	// 处理内容
	const content = []

	// 提取需要作为文本显示的字段
	const basicInfo = {
		status: result.status,
		message: result.message,
		currentUrl: result.currentUrl,
	}

	// 如果有标签页列表，添加到基本信息中 (确保总是将tabs放入响应)
	basicInfo.tabs = Array.isArray(result.tabs) ? result.tabs : []

	// 如果有tabId，添加到基本信息中
	if (result.tabId) {
		basicInfo.tabId = result.tabId
	}

	// 如果有newTabOpened等特殊字段，添加到基本信息中
	if (result.newTabOpened) {
		basicInfo.newTabOpened = result.newTabOpened
		if (result.newTabId) basicInfo.newTabId = result.newTabId
		if (result.newTabUrl) basicInfo.newTabUrl = result.newTabUrl
	}

	content.push({
		type: "text",
		text: JSON.stringify(basicInfo),
	})

	// 如果有截图，添加为图像类型
	if (result.screenshot && typeof result.screenshot === "string" && result.screenshot.startsWith("data:image")) {
		try {
			// 提取base64数据部分
			const base64Data = result.screenshot.split(",")[1]
			const mimeType = result.screenshot.split(",")[0].split(":")[1].split(";")[0]

			content.push({
				type: "image",
				data: base64Data,
				mimeType: mimeType || "image/jpeg",
			})
		} catch (error) {
			console.error("Error processing screenshot in formatResponse:", error)
			// 添加错误信息到响应中
			content.push({
				type: "text",
				text: JSON.stringify({ error: "Failed to process screenshot", details: error.message }),
			})
		}
	}

	return { content }
}
