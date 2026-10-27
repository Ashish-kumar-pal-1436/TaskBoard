import { z } from "zod";

const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters.")
  .max(72, "Password must be no more than 72 characters.")
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
    message: "Password must be no more than 72 UTF-8 bytes.",
  });

export const registerSchema = z
  .object({
    email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
    displayName: z.string().trim().min(2).max(60),
    password: passwordSchema,
  })
  .strict();

export const loginSchema = z
  .object({
    email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
    password: z
      .string()
      .min(1)
      .max(72)
      .refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
        message: "Password must be no more than 72 UTF-8 bytes.",
      }),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
