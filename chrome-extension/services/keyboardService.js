/**
 * 键盘服务模块 - 提供跨平台的键盘操作增强功能
 */

import { debugTarget } from "./debuggerService.js"
import { getActiveTabId } from "./tabService.js"

// 键码映射常量
const KEY_MAPPINGS = {
	// 功能键
	Enter: { code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r" },
	Tab: { code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, text: "\t" },
	Escape: { code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 },
	Backspace: { code: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 },
	Delete: { code: "Delete", windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 },
	Space: { code: "Space", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32, text: " " },

	// 导航键
	ArrowUp: { code: "ArrowUp", windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38 },
	ArrowDown: { code: "ArrowDown", windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 },
	ArrowLeft: { code: "ArrowLeft", windowsVirtualKeyCode: 37, nativeVirtualKeyCode: 37 },
	ArrowRight: { code: "ArrowRight", windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 },
	Home: { code: "Home", windowsVirtualKeyCode: 36, nativeVirtualKeyCode: 36 },
	End: { code: "End", windowsVirtualKeyCode: 35, nativeVirtualKeyCode: 35 },
	PageUp: { code: "PageUp", windowsVirtualKeyCode: 33, nativeVirtualKeyCode: 33 },
	PageDown: { code: "PageDown", windowsVirtualKeyCode: 34, nativeVirtualKeyCode: 34 },

	// 功能键 F1-F12
	F1: { code: "F1", windowsVirtualKeyCode: 112, nativeVirtualKeyCode: 112 },
	F2: { code: "F2", windowsVirtualKeyCode: 113, nativeVirtualKeyCode: 113 },
	F3: { code: "F3", windowsVirtualKeyCode: 114, nativeVirtualKeyCode: 114 },
	F4: { code: "F4", windowsVirtualKeyCode: 115, nativeVirtualKeyCode: 115 },
	F5: { code: "F5", windowsVirtualKeyCode: 116, nativeVirtualKeyCode: 116 },
	F6: { code: "F6", windowsVirtualKeyCode: 117, nativeVirtualKeyCode: 117 },
	F7: { code: "F7", windowsVirtualKeyCode: 118, nativeVirtualKeyCode: 118 },
	F8: { code: "F8", windowsVirtualKeyCode: 119, nativeVirtualKeyCode: 119 },
	F9: { code: "F9", windowsVirtualKeyCode: 120, nativeVirtualKeyCode: 120 },
	F10: { code: "F10", windowsVirtualKeyCode: 121, nativeVirtualKeyCode: 121 },
	F11: { code: "F11", windowsVirtualKeyCode: 122, nativeVirtualKeyCode: 122 },
	F12: { code: "F12", windowsVirtualKeyCode: 123, nativeVirtualKeyCode: 123 },
}

// 修饰键映射 - 跨平台
const MODIFIER_MAPPINGS = {
	// Windows/Linux 修饰键
	Control: { code: "ControlLeft", windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17, modifiersMask: 2 },
	Alt: { code: "AltLeft", windowsVirtualKeyCode: 18, nativeVirtualKeyCode: 18, modifiersMask: 1 },
	Shift: { code: "ShiftLeft", windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16, modifiersMask: 8 },
	Meta: { code: "MetaLeft", windowsVirtualKeyCode: 91, nativeVirtualKeyCode: 91, modifiersMask: 4 },

	// Mac 常用别名 - 在代码中会自动转换
	Command: { aliasFor: "Meta" },
	Cmd: { aliasFor: "Meta" },
	Option: { aliasFor: "Alt" },
	Opt: { aliasFor: "Alt" },
}

/**
 * 获取平台相关的修饰键映射
 * @param {string} modifier - 修饰键名称
 * @returns {Object} 修饰键映射
 */
function getPlatformModifier(modifier) {
	const normalizedModifier = modifier.trim()

	// 处理Mac别名转换
	if (MODIFIER_MAPPINGS[normalizedModifier]?.aliasFor) {
		return MODIFIER_MAPPINGS[MODIFIER_MAPPINGS[normalizedModifier].aliasFor]
	}

	return MODIFIER_MAPPINGS[normalizedModifier] || null
}

/**
 * 标准化键名，确保与Chrome Debugger API兼容
 * @param {string} keyName - 键名
 * @returns {string} 标准化的键名
 */
function normalizeKeyName(keyName) {
	const normalized = keyName.trim()

	// 检查是否为特殊键映射
	if (KEY_MAPPINGS[normalized]) {
		return normalized
	}

	// 检查是否为修饰键
	if (MODIFIER_MAPPINGS[normalized]) {
		// 如果是别名，返回实际键名
		if (MODIFIER_MAPPINGS[normalized].aliasFor) {
			return MODIFIER_MAPPINGS[normalized].aliasFor
		}
		return normalized
	}

	// 单字符键直接返回
	if (normalized.length === 1) {
		return normalized
	}

	// 默认情况
	return normalized
}

/**
 * 获取键的详细参数
 * @param {string} key - 键名
 * @returns {Object} 键的详细参数
 */
function getKeyParams(key) {
	const normalizedKey = normalizeKeyName(key)

	// 如果是已知特殊键
	if (KEY_MAPPINGS[normalizedKey]) {
		return {
			key: normalizedKey,
			...KEY_MAPPINGS[normalizedKey],
		}
	}

	// 如果是修饰键
	if (MODIFIER_MAPPINGS[normalizedKey] && !MODIFIER_MAPPINGS[normalizedKey].aliasFor) {
		return {
			key: normalizedKey,
			...MODIFIER_MAPPINGS[normalizedKey],
		}
	}

	// 处理单字符键
	if (normalizedKey.length === 1) {
		return {
			key: normalizedKey,
			code: `Key${normalizedKey.toUpperCase()}`,
			text: normalizedKey,
			windowsVirtualKeyCode: normalizedKey.charCodeAt(0),
			nativeVirtualKeyCode: normalizedKey.charCodeAt(0),
		}
	}

	// 默认情况：未知键，只提供基本参数
	return {
		key: normalizedKey,
		code: normalizedKey,
	}
}

/**
 * 计算多个修饰键的组合掩码
 * @param {string[]} modifiers - 修饰键数组
 * @returns {number} 组合掩码
 */
function calculateModifiersMask(modifiers) {
	return modifiers.reduce((mask, modifier) => {
		const modObj = getPlatformModifier(modifier)
		return modObj ? mask | modObj.modifiersMask : mask
	}, 0)
}

/**
 * 附加调试器到标签页（如果尚未附加）
 * @param {number} tabId - 标签页ID
 * @returns {Promise<void>}
 */
async function ensureDebuggerAttached(tabId) {
	if (!tabId) {
		throw new Error("Missing tabId for keyboard operation")
	}

	const debuggerTarget = { tabId }
	const debuggerProtocolVersion = "1.3"

	// 检查是否已附加调试器
	if (!debugTarget || debugTarget.tabId !== tabId) {
		if (debugTarget) {
			try {
				await chrome.debugger.detach(debugTarget)
			} catch (e) {
				console.warn(`[KeyboardService] Error detaching previous debug target: ${e.message}`)
			}
		}
		await chrome.debugger.attach(debuggerTarget, debuggerProtocolVersion)
		debugTarget = debuggerTarget
		console.log(`[KeyboardService] Attached debugger to tab ${tabId} for keyboard operation.`)
	}
}

/**
 * 执行单个按键操作（增强版）
 * @param {number} tabId - 标签页ID
 * @param {string} key - 键名
 * @returns {Promise<void>}
 */
export async function pressKey(tabId, key) {
	console.log(`[KeyboardService] Pressing key: ${key} on tab ${tabId}`)

	await ensureDebuggerAttached(tabId)

	// 获取键参数
	const keyParams = getKeyParams(key)
	console.log(`[KeyboardService] Key parameters: `, keyParams)

	// 构建事件参数
	const keyDownParams = {
		type: "keyDown",
		key: keyParams.key,
		code: keyParams.code,
		...(keyParams.windowsVirtualKeyCode && { windowsVirtualKeyCode: keyParams.windowsVirtualKeyCode }),
		...(keyParams.nativeVirtualKeyCode && { nativeVirtualKeyCode: keyParams.nativeVirtualKeyCode }),
	}

	const keyUpParams = {
		type: "keyUp",
		key: keyParams.key,
		code: keyParams.code,
		...(keyParams.windowsVirtualKeyCode && { windowsVirtualKeyCode: keyParams.windowsVirtualKeyCode }),
		...(keyParams.nativeVirtualKeyCode && { nativeVirtualKeyCode: keyParams.nativeVirtualKeyCode }),
	}

	const charParams = keyParams.text ? { type: "char", text: keyParams.text } : null

	// 发送事件
	const debuggerTarget = { tabId }
	console.log(`[KeyboardService] Sending keyDown event for: ${key}`)
	await chrome.debugger.sendCommand(debuggerTarget, "Input.dispatchKeyEvent", keyDownParams)

	if (charParams) {
		console.log(`[KeyboardService] Sending char event for: ${key}`)
		await chrome.debugger.sendCommand(debuggerTarget, "Input.dispatchKeyEvent", charParams)
	}

	console.log(`[KeyboardService] Sending keyUp event for: ${key}`)
	await chrome.debugger.sendCommand(debuggerTarget, "Input.dispatchKeyEvent", keyUpParams)

	console.log(`[KeyboardService] Successfully dispatched key events for: ${key} to tab ${tabId}`)
}

/**
 * 执行组合键操作（增强版，支持跨平台）
 * @param {number} tabId - 标签页ID
 * @param {string} combination - 组合键，如 "Control+C" 或 "Command+C"
 * @returns {Promise<void>}
 */
export async function pressKeyCombination(tabId, combination) {
	console.log(`[KeyboardService] Pressing combination: ${combination} on tab ${tabId}`)

	await ensureDebuggerAttached(tabId)

	// 解析组合键
	const keys = combination.split("+").map((k) => k.trim())
	const mainKey = keys.pop() // 最后一个是主键
	const modifiers = keys // 其余是修饰键

	// 获取主键参数
	const mainKeyParams = getKeyParams(mainKey)

	// 计算修饰键掩码
	const modifiersMask = calculateModifiersMask(modifiers)

	// 获取修饰键参数数组
	const modifierParams = modifiers.map((mod) => {
		const normalizedMod = normalizeKeyName(mod)
		return getKeyParams(normalizedMod)
	})

	const debuggerTarget = { tabId }

	// 按下所有修饰键
	for (const modParam of modifierParams) {
		console.log(`[KeyboardService] Pressing modifier: ${modParam.key}`)
		await chrome.debugger.sendCommand(debuggerTarget, "Input.dispatchKeyEvent", {
			type: "keyDown",
			key: modParam.key,
			code: modParam.code,
			...(modParam.windowsVirtualKeyCode && { windowsVirtualKeyCode: modParam.windowsVirtualKeyCode }),
			...(modParam.nativeVirtualKeyCode && { nativeVirtualKeyCode: modParam.nativeVirtualKeyCode }),
		})
	}

	// 按下主键
	console.log(`[KeyboardService] Pressing main key: ${mainKeyParams.key} with modifiers`)
	await chrome.debugger.sendCommand(debuggerTarget, "Input.dispatchKeyEvent", {
		type: "keyDown",
		key: mainKeyParams.key,
		code: mainKeyParams.code,
		modifiers: modifiersMask,
		...(mainKeyParams.windowsVirtualKeyCode && { windowsVirtualKeyCode: mainKeyParams.windowsVirtualKeyCode }),
		...(mainKeyParams.nativeVirtualKeyCode && { nativeVirtualKeyCode: mainKeyParams.nativeVirtualKeyCode }),
	})

	// 发送字符事件（如果适用）
	if (mainKeyParams.text) {
		await chrome.debugger.sendCommand(debuggerTarget, "Input.dispatchKeyEvent", {
			type: "char",
			text: mainKeyParams.text,
			modifiers: modifiersMask,
		})
	}

	// 释放主键
	await chrome.debugger.sendCommand(debuggerTarget, "Input.dispatchKeyEvent", {
		type: "keyUp",
		key: mainKeyParams.key,
		code: mainKeyParams.code,
		modifiers: modifiersMask,
		...(mainKeyParams.windowsVirtualKeyCode && { windowsVirtualKeyCode: mainKeyParams.windowsVirtualKeyCode }),
		...(mainKeyParams.nativeVirtualKeyCode && { nativeVirtualKeyCode: mainKeyParams.nativeVirtualKeyCode }),
	})

	// 释放所有修饰键（反序）
	for (const modParam of modifierParams.reverse()) {
		console.log(`[KeyboardService] Releasing modifier: ${modParam.key}`)
		await chrome.debugger.sendCommand(debuggerTarget, "Input.dispatchKeyEvent", {
			type: "keyUp",
			key: modParam.key,
			code: modParam.code,
			...(modParam.windowsVirtualKeyCode && { windowsVirtualKeyCode: modParam.windowsVirtualKeyCode }),
			...(modParam.nativeVirtualKeyCode && { nativeVirtualKeyCode: modParam.nativeVirtualKeyCode }),
		})
	}

	console.log(`[KeyboardService] Successfully dispatched key combination: ${combination} to tab ${tabId}`)
}

/**
 * 执行单个按键操作（无需传入tabId，自动获取活动标签页）
 * @param {string} key - 键名
 * @returns {Promise<void>}
 */
export async function pressKeyOnActiveTab(key) {
	const activeTabId = getActiveTabId()
	if (!activeTabId) {
		throw new Error("无可用的活动标签页执行按键操作")
	}

	return pressKey(activeTabId, key)
}

/**
 * 执行组合键操作（无需传入tabId，自动获取活动标签页）
 * @param {string} combination - 组合键，如 "Control+C" 或 "Command+C"
 * @returns {Promise<void>}
 */
export async function pressKeyCombinationOnActiveTab(combination) {
	const activeTabId = getActiveTabId()
	if (!activeTabId) {
		throw new Error("无可用的活动标签页执行组合键操作")
	}

	return pressKeyCombination(activeTabId, combination)
}

// 导出标准化函数，便于其他服务使用
export { normalizeKeyName, getKeyParams }
