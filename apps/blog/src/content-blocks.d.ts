// Types for the plain-JS block names shared by the engine and the blog (packages/content/src/blocks.js).
declare module '@m91/content/blocks' {
  export const BLOCK_TYPES: readonly string[]
  export const BUILT_BLOCK_TYPES: readonly string[]
  export const BLOCK_ID_RE: RegExp
  export function isBlockType(name: string): boolean
  export function isBuiltBlockType(name: string): boolean
}
