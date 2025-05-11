/**
 * 模块测试文件
 * 本文件用于确认所有模块都可以正确加载，不会产生循环依赖问题。
 */

import { connectWebSocket, sendMessageToServer } from "./services/websocketService.js"
import { initTabListeners, handleNavigate } from "./services/tabService.js"
import { initDebuggerListeners, attachDebugger, detachDebuggerIfNeeded } from "./services/debuggerService.js"
import { captureVisibleTabState, captureVisibleTabPromise } from "./services/screenshotService.js"
import {
	performClick,
	performType,
	performPressKey,
	performKeyCombination,
	performScroll,
} from "./services/interactionService.js"
import { executeScriptInTab, getFullHtml, getViewportSize } from "./services/contentService.js"
import { updateViewportConfig, applyViewportConfig } from "./services/viewportService.js"
import { getModifierBit, getModifiersBitmask } from "./utils/browserUtils.js"
import { waitTillHTMLStable } from "./utils/domUtils.js"
import { handleCommandFromServer } from "./handlers/commandHandlers.js"

console.log("模块测试加载成功！所有模块都能正确导入，没有循环依赖问题。")
