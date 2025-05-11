/**
 * 获取单个修饰符的位掩码
 * @param {string} modifierName - 修饰符名称
 * @returns {number} 位掩码
 */
export function getModifierBit(modifierName) {
	return 1 << (modifierName.charCodeAt(0) - "A".charCodeAt(0))
}

/**
 * 获取多个修饰符的组合位掩码
 * @param {string[]} modifiers - 修饰符数组
 * @returns {number} 组合位掩码
 */
export function getModifiersBitmask(modifiers) {
	let mask = 0
	for (const mod of modifiers) {
		mask |= getModifierBit(mod)
	}
	return mask
}
