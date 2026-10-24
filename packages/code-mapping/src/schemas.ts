import { z } from 'zod';
import { AnchorOriginSchema, SymbolKindSchema, nonEmptyString } from '@codementor/contracts';

export const CreateAnchorInputSchema = z.object({
  decisionId: nonEmptyString,
  filePath: nonEmptyString,
  /** 符号链，末位为定位键，如 ["scheduler"] 或 ["pcb"]。 */
  symbolPath: z.array(nonEmptyString).min(1),
  /** 可选：按类别过滤候选；缺省只按名称匹配。 */
  symbolKind: SymbolKindSchema.optional(),
  /** declared=显式关联；inferred=自动匹配接受后的落库，展示时必须标注。 */
  origin: AnchorOriginSchema,
});

export const ProposeAnchorsInputSchema = z.object({
  taskId: nonEmptyString,
  oldRev: nonEmptyString,
  newRev: nonEmptyString,
});

export type CreateAnchorInput = z.infer<typeof CreateAnchorInputSchema>;
export type ProposeAnchorsInput = z.infer<typeof ProposeAnchorsInputSchema>;
