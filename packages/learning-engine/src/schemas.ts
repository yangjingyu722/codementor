import { z } from 'zod';

export const SubmitAttemptInputSchema = z.object({
  answer: z.string().min(1),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
});

export type SubmitAttemptInput = z.infer<typeof SubmitAttemptInputSchema>;
