export { MappingService, createDefaultRegistry, hashSymbolText } from './mapping-service.js';
export type {
  AnchorProposal,
  AnchorSymbolMatch,
  MappingServiceOptions,
  RevalidateResult,
  RevalidateResultItem,
} from './mapping-service.js';
export { CSourceParser } from './c-parser.js';
export { GitClient, GitError } from './git-client.js';
export type { DiffHunk, FileChange } from './git-client.js';
export { ParserRegistry } from './symbols.js';
export type { ParseResult, SourceParser, SymbolInfo } from './symbols.js';
export { CreateAnchorInputSchema, ProposeAnchorsInputSchema } from './schemas.js';
export type { CreateAnchorInput, ProposeAnchorsInput } from './schemas.js';
