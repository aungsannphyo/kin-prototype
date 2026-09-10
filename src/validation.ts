/**
 * State Validation Helper
 *
 * Enforces v0.1 state model: only primitives, plain objects, and arrays are allowed.
 * Special objects (Date, RegExp, Map, Set, class instances, etc.) are rejected.
 */

/**
 * Check if a value is a special built-in object that should be rejected.
 */
function isSpecialObject(value: unknown): boolean {
  if (!(value instanceof Object)) {
    return false
  }

  // Collection types
  if (value instanceof Map || value instanceof Set || 
      value instanceof WeakMap || value instanceof WeakSet) {
    return true
  }

  // Date and RegExp
  if (value instanceof Date || value instanceof RegExp) {
    return true
  }

  // Async and Promise
  if (value instanceof Promise) {
    return true
  }

  // Binary data types
  if (value instanceof ArrayBuffer || value instanceof DataView) {
    return true
  }

  // Typed arrays
  if (value instanceof Int8Array || value instanceof Uint8Array ||
      value instanceof Uint8ClampedArray || value instanceof Int16Array ||
      value instanceof Uint16Array || value instanceof Int32Array ||
      value instanceof Uint32Array || value instanceof Float32Array ||
      value instanceof Float64Array || value instanceof BigInt64Array ||
      value instanceof BigUint64Array) {
    return true
  }

  return false
}

/**
 * Validate a single property value with error handling.
 */
function validateProperty(
  value: unknown,
  keyPath: string,
  visited: WeakSet<object>
): void {
  try {
    validateStateValue(value, keyPath, visited)
  } catch (e) {
    if (e instanceof Error) {
      throw new TypeError(
        `Invalid state at path "${keyPath}": ${e.message}`
      )
    }
    throw e
  }
}

/**
 * Validate all properties of an object (string keys and symbol keys).
 */
function validateObjectProperties(
  value: object,
  path: string,
  visited: WeakSet<object>
): void {
  // Validate string-keyed properties
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor?.get) {
      // Getter properties are allowed - skip validation to avoid side effects
      continue
    }
    validateProperty((value as Record<string, unknown>)[key], `${path}.${key}`, visited)
  }

  // Validate symbol-keyed properties
  for (const key of Object.getOwnPropertySymbols(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor?.get) {
      // Getter properties are allowed - skip validation
      continue
    }
    validateProperty(
      (value as Record<symbol, unknown>)[key],
      `${path}[Symbol(${key.description})]`,
      visited
    )
  }
}

/**
 * Validate that a state value conforms to v0.1 model.
 * Throws TypeError if invalid state is found.
 *
 * Allowed:
 * - primitives (string, number, boolean, null, undefined, symbol, bigint)
 * - plain objects (created via {} or new Object())
 * - arrays
 *
 * Rejected:
 * - Date, RegExp, Map, Set, WeakMap, WeakSet
 * - class instances
 * - typed arrays (Int8Array, Uint8Array, etc.)
 * - ArrayBuffer, DataView
 * - Promise, other built-in special objects
 * - functions (as state values)
 *
 * @param value - The state value to validate
 * @param path - Current path for error messages (for nested structures)
 * @param visited - WeakSet to handle cyclic references safely
 */
export function validateStateValue(
  value: unknown,
  path: string = '',
  visited: WeakSet<object> = new WeakSet<object>()
): void {
  // Primitives are always valid
  if (value === null || typeof value !== 'object') {
    return
  }

  // Handle cyclic references
  if (visited.has(value)) {
    return
  }
  visited.add(value)

  // Arrays are valid, but we must validate their elements
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      validateStateValue(value[i], `${path}[${i}]`, visited)
    }
    return
  }

  // Reject special built-in objects
  if (isSpecialObject(value)) {
    throw new TypeError(
      `Invalid state at path "${path}": ${(value as object).constructor.name} is not supported in v0.1 state model. ` +
      `Only primitives, plain objects, and arrays are allowed.`
    )
  }

  // Reject functions
  if (typeof value === 'function') {
    throw new TypeError(
      `Invalid state at path "${path}": functions are not supported in v0.1 state model. ` +
      `Only primitives, plain objects, and arrays are allowed.`
    )
  }

  // Check for plain objects by prototype chain
  const proto = Object.getPrototypeOf(value)
  if (proto !== null && proto !== Object.prototype) {
    throw new TypeError(
      `Invalid state at path "${path}": class instance or special object is not supported in v0.1 state model. ` +
      `Only primitives, plain objects, and arrays are allowed.`
    )
  }

  // Validate plain object properties recursively
  validateObjectProperties(value, path, visited)
}

/**
 * Validate a complete state record.
 * This is the main entry point for state validation.
 *
 * @param state - The state record to validate
 */
export function validateStateRecord(state: Record<string, unknown>): void {
  validateStateValue(state, 'state')
}
