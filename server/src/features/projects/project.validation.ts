import { z } from "zod";

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
  })
  .strict();

export const projectIdSchema = z.object({
  projectId: z
    .string()
    .regex(/^[0-9a-f]{24}$/i, "Invalid project ID.")
    .transform((value) => value.toLowerCase()),
});

export const addProjectMemberSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
  })
  .strict();

const objectIdSchema = z
  .string()
  .regex(/^[0-9a-f]{24}$/i, "Invalid ID.")
  .transform((value) => value.toLowerCase());

export const projectColumnParamsSchema = z.object({
  projectId: objectIdSchema,
  columnId: objectIdSchema,
});

export const renameColumnSchema = z
  .object({
    name: z.string().trim().min(1).max(50),
  })
  .strict();

export const reorderColumnsSchema = z
  .object({
    columnIds: z.array(objectIdSchema).min(1),
  })
  .strict()
  .refine(
    ({ columnIds }) => new Set(columnIds.map((id) => id.toLowerCase())).size === columnIds.length,
    { path: ["columnIds"], message: "Column IDs must be unique." },
  );

const cardTitleSchema = z.string().trim().min(1).max(120);
const cardDescriptionSchema = z.string().max(2000);
const cardLabelsSchema = z
  .array(z.string().trim().min(1).max(24))
  .max(8)
  .refine((labels) => new Set(labels.map((label) => label.toLowerCase())).size === labels.length, {
    message: "Labels must be unique.",
  });
const optionalDateSchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .nullable();

export const createCardSchema = z
  .object({
    columnId: objectIdSchema,
    title: cardTitleSchema,
    description: cardDescriptionSchema.optional().default(""),
    assigneeId: objectIdSchema.nullable().optional().default(null),
    dueDate: optionalDateSchema.optional().default(null),
    labels: cardLabelsSchema.optional().default([]),
  })
  .strict();

export const updateCardSchema = z
  .object({
    title: cardTitleSchema.optional(),
    description: cardDescriptionSchema.optional(),
    assigneeId: objectIdSchema.nullable().optional(),
    dueDate: optionalDateSchema.optional(),
    labels: cardLabelsSchema.optional(),
  })
  .strict()
  .refine((values) => Object.keys(values).length > 0, {
    message: "Provide at least one card field to update.",
  });

export const moveCardSchema = z
  .object({
    columnId: objectIdSchema,
    beforeCardId: objectIdSchema.optional(),
  })
  .strict();

export const cardParamsSchema = z.object({
  projectId: objectIdSchema,
  cardId: objectIdSchema,
});

export const commentSchema = z
  .object({
    content: z.string().trim().min(1).max(2000),
  })
  .strict();

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;
export type RenameColumnInput = z.infer<typeof renameColumnSchema>;
export type ReorderColumnsInput = z.infer<typeof reorderColumnsSchema>;
export type CreateCardInput = z.infer<typeof createCardSchema>;
export type UpdateCardInput = z.infer<typeof updateCardSchema>;
export type MoveCardInput = z.infer<typeof moveCardSchema>;
export type CreateCommentInput = z.infer<typeof commentSchema>;
