import { model, Schema, type InferSchemaType } from "mongoose";

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 60,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    tokenVersion: {
      type: Number,
      required: true,
      default: 0,
      select: false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_document, value: Record<string, unknown>) => {
        delete value.passwordHash;
        delete value.tokenVersion;
        delete value.__v;
        return value;
      },
    },
  },
);

export type UserDocumentShape = InferSchemaType<typeof userSchema>;

export const UserModel = model("User", userSchema);
