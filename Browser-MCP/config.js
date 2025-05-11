import * as path from "path"
import * as os from "os"

// 定义WebSocket端口
export const WEBSOCKET_PORT = 9876

// 添加在导入部分下方，定义固定的HTML临时文件路径
export const tempHtmlPath = path.join(os.tmpdir(), "chrome_server_temp.html")

// 添加固定的图片保存目录
export const screenshotSaveDir = path.join(os.tmpdir(), "chrome_extension_screenshots")

// 添加默认的viewport配置
export const DEFAULT_VIEWPORT = {
	width: 800,
	height: 600,
}
